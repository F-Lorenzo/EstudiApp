import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { canRate } from "@/lib/ratings/window";
import { DailyError, roomNameFor, type DailyClient } from "./daily";

/**
 * Quién entra a la sala de una clase y cuándo.
 *
 *  - Solo las DOS personas de la reserva: el alumno que la hizo y su docente. La reserva se lee con la sesión de
 *    quien entra, así que la RLS ya filtra (nadie más la ve); además se compara el id contra el de la sesión.
 *  - Solo una reserva confirmada (pagada). Una pendiente, cancelada o completada no abre la sala.
 *  - Solo en el horario: se entra desde `ROOM_OPENS_BEFORE_MINUTES` antes del inicio hasta el final de la clase. La
 *    sala y el token vencen `ROOM_GRACE_AFTER_MINUTES` después del final y expulsan a quien siga adentro.
 *
 * El token se pide recién cuando se cumple todo eso: sin token no se entra a una sala privada de Daily.
 */
export const ROOM_OPENS_BEFORE_MINUTES = 10;
export const ROOM_GRACE_AFTER_MINUTES = 10;

const MINUTE = 60_000;

export type RoomRole = "alumno" | "docente";

export type RoomView = {
  bookingId: string;
  role: RoomRole;
  startsAt: string;
  endsAt: string;
  /** La otra persona de la clase: el docente para el alumno, el alumno para el docente. */
  otherName: string;
  otherPhoto: string | null;
};

export type RoomAccess =
  | { state: "not_found" }
  /** Todavía no abrió: se abre en `opensAt` (ISO). */
  | { state: "not_yet"; view: RoomView; opensAt: string }
  /**
   * La clase ya terminó (o la reserva ya figura como completada). `rating` es solo para el alumno: la que ya dejó
   * y si todavía puede calificar.
   */
  | { state: "ended"; view: RoomView; rating: { score: number | null; canRate: boolean } | null }
  /** Falta configurar Daily en el servidor. */
  | { state: "unavailable"; view: RoomView }
  /** Daily no respondió: se puede reintentar. */
  | { state: "error"; view: RoomView }
  | { state: "open"; view: RoomView; roomUrl: string; token: string };

type PersonEmbed = { full_name: string | null; avatar_url: string | null };
const one = <T,>(value: T | T[] | null | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;

const rowSchema = z.object({
  id: z.string(),
  status: z.string(),
  student_id: z.string(),
  tutor_id: z.string(),
  starts_at: z.string(),
  ends_at: z.string(),
  profiles: z.unknown().optional(),
  tutor_profiles: z.unknown().optional(),
  ratings: z.unknown().optional(),
});

export function roomWindow(startsAt: string, endsAt: string) {
  return {
    opensAt: new Date(new Date(startsAt).getTime() - ROOM_OPENS_BEFORE_MINUTES * MINUTE),
    entryUntil: new Date(endsAt),
    closesAt: new Date(new Date(endsAt).getTime() + ROOM_GRACE_AFTER_MINUTES * MINUTE),
  };
}

export async function getRoomAccess(
  {
    supabase,
    daily,
    now = new Date(),
  }: {
    /** Cliente con la sesión de quien entra (la RLS decide qué reservas ve). */
    supabase: Pick<SupabaseClient, "from">;
    /** `null` si falta `DAILY_API_KEY`. */
    daily: Pick<DailyClient, "ensureRoom" | "createMeetingToken"> | null;
    now?: Date;
  },
  { bookingId, viewer }: { bookingId: string; viewer: { id: string; role: string | null } },
): Promise<RoomAccess> {
  if (!z.uuid().safeParse(bookingId).success) return { state: "not_found" };
  if (viewer.role !== "alumno" && viewer.role !== "docente") return { state: "not_found" };
  const role: RoomRole = viewer.role;

  const { data, error } = await supabase
    .from("bookings")
    .select(
      "id, status, student_id, tutor_id, starts_at, ends_at, profiles(full_name, avatar_url), tutor_profiles(profiles(full_name, avatar_url)), ratings(score)",
    )
    .eq("id", bookingId)
    .maybeSingle();
  if (error) return { state: "not_found" };
  const parsed = rowSchema.safeParse(data);
  if (!parsed.success) return { state: "not_found" };
  const row = parsed.data;

  // La persona tiene que ser ESA parte de la reserva, no solo alguien que pueda leerla.
  if (role === "alumno" ? row.student_id !== viewer.id : row.tutor_id !== viewer.id) return { state: "not_found" };
  if (row.status !== "confirmada" && row.status !== "completada") return { state: "not_found" };

  const student = one(row.profiles as PersonEmbed | PersonEmbed[] | null);
  const tutor = one(one(row.tutor_profiles as { profiles: PersonEmbed | PersonEmbed[] | null } | null)?.profiles);
  const other = role === "alumno" ? tutor : student;
  // El nombre con el que entra a la videollamada sale de su perfil, nunca del email.
  const self = role === "alumno" ? student : tutor;
  const selfName = self?.full_name?.trim() || (role === "alumno" ? "Estudiante" : "Docente");
  const view: RoomView = {
    bookingId: row.id,
    role,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    otherName: other?.full_name?.trim() || (role === "alumno" ? "Docente" : "Estudiante"),
    otherPhoto: other?.avatar_url || null,
  };

  const { opensAt, entryUntil, closesAt } = roomWindow(row.starts_at, row.ends_at);
  if (row.status === "completada" || now.getTime() >= entryUntil.getTime()) {
    const score = one(row.ratings as { score: number } | { score: number }[] | null)?.score ?? null;
    const rating =
      role === "alumno" ? { score, canRate: canRate({ status: row.status, endsAt: row.ends_at, score }, now) } : null;
    return { state: "ended", view, rating };
  }
  if (now.getTime() < opensAt.getTime()) return { state: "not_yet", view, opensAt: opensAt.toISOString() };
  if (!daily) return { state: "unavailable", view };

  try {
    const room = await daily.ensureRoom({ name: roomNameFor(row.id), opensAt, closesAt });
    const token = await daily.createMeetingToken({
      roomName: room.name,
      userName: selfName,
      userId: viewer.id,
      isOwner: role === "docente",
      opensAt,
      closesAt,
    });
    return { state: "open", view, roomUrl: room.url, token };
  } catch (cause) {
    console.error(
      JSON.stringify({
        source: "video-room",
        message: "no se pudo preparar la sala",
        bookingId: row.id,
        status: cause instanceof DailyError ? cause.status : null,
      }),
    );
    return { state: "error", view };
  }
}
