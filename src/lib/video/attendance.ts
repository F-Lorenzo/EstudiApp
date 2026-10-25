import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { DailyError, roomNameFor, type DailyClient, type DailyMeeting } from "./daily";
import { roomWindow } from "./room-access";

/**
 * Asistencia a la sala (migración 0017). Cuando termina una clase, se le pregunta a Daily cuánto estuvo cada
 * persona y se le pasa a la base (`record_class_attendance`), que decide:
 *
 *  - el docente estuvo 10 minutos o más → la clase queda «completada» (haya entrado el alumno o no);
 *  - el docente no llegó a 10 minutos → cuando la sala ya cerró, la reserva se cancela y se devuelve el 100 %.
 *
 * Lo de acá solo cuenta minutos y orquesta: la regla y el dinero son de la base. Si Daily no responde, no se
 * registra nada y se vuelve a intentar más tarde; a los 3 días sin datos la base completa la clase sola (nunca
 * reembolsa por falta de datos).
 */

export type AwaitingClass = { id: string; studentId: string; tutorId: string; startsAt: string; endsAt: string };

export type AttendanceOutcome =
  /** Todavía no se puede decidir (la sala sigue abierta y el docente no llegó a 10 minutos). */
  | "pendiente"
  | "completada"
  | "docente_ausente"
  /** Ya estaba registrada (otra pestaña, el cron). */
  | "ya_registrada"
  /** Falta `DAILY_API_KEY`: no hay de dónde sacar la asistencia. */
  | "sin_datos"
  /** Daily o la base fallaron: se reintenta en la próxima pasada. */
  | "error";

export type AttendanceDeps = {
  /** Cliente con permisos de sistema: `record_class_attendance` es solo del backend. */
  admin: Pick<SupabaseClient, "rpc">;
  daily: Pick<DailyClient, "listMeetings"> | null;
  /** Ejecuta el reembolso que dejó la base (el mismo camino que una cancelación) y pide enviar los emails. */
  afterAbsence: (data: unknown) => Promise<void>;
  now?: Date;
  log?: (message: string, data?: Record<string, unknown>) => void;
};

const defaultLog = (message: string, data?: Record<string, unknown>) =>
  console.error(JSON.stringify({ source: "class-attendance", message, ...data }));

/**
 * Segundos que estuvo una persona en la sala, sumando todas sus entradas. Una entrada de una sesión que sigue en
 * curso y todavía no informa su duración cuenta desde que entró hasta ahora.
 */
export function secondsInRoom(meetings: DailyMeeting[], userId: string, now: Date) {
  const nowSeconds = Math.floor(now.getTime() / 1000);
  let total = 0;
  for (const meeting of meetings) {
    for (const participant of meeting.participants ?? []) {
      if (participant.user_id !== userId) continue;
      const reported = participant.duration ?? 0;
      const live = meeting.ongoing && reported <= 0 ? nowSeconds - participant.join_time : 0;
      total += Math.max(0, reported, live);
    }
  }
  return Math.round(total);
}

const resultSchema = z.object({ outcome: z.enum(["pendiente", "completada", "docente_ausente"]), already: z.boolean().optional() });

/** Registra la asistencia de una clase terminada. Nunca lanza. */
export async function settleClassAttendance(deps: AttendanceDeps, item: AwaitingClass): Promise<AttendanceOutcome> {
  const log = deps.log ?? defaultLog;
  const now = deps.now ?? new Date();
  if (new Date(item.endsAt).getTime() > now.getTime()) return "pendiente";
  if (!deps.daily) return "sin_datos";

  let meetings: DailyMeeting[];
  try {
    meetings = await deps.daily.listMeetings({
      roomName: roomNameFor(item.id),
      since: roomWindow(item.startsAt, item.endsAt).opensAt,
    });
  } catch (error) {
    log("no se pudo leer la asistencia en Daily", { bookingId: item.id, status: error instanceof DailyError ? error.status : null });
    return "error";
  }

  const { data, error } = await deps.admin.rpc("record_class_attendance", {
    p_booking_id: item.id,
    p_tutor_seconds: secondsInRoom(meetings, item.tutorId, now),
    p_student_seconds: secondsInRoom(meetings, item.studentId, now),
  });
  if (error) {
    // `not_confirmed`: la reserva ya no estaba confirmada (por ejemplo, la completó la red de seguridad de 3 días).
    if ((error as { hint?: string }).hint === "not_confirmed") return "ya_registrada";
    log("no se pudo registrar la asistencia", { bookingId: item.id, code: (error as { code?: string }).code ?? null });
    return "error";
  }
  const parsed = resultSchema.safeParse(data);
  if (!parsed.success) {
    log("record_class_attendance devolvió algo que no se entiende", { bookingId: item.id });
    return "error";
  }
  if (parsed.data.already) return "ya_registrada";
  if (parsed.data.outcome === "docente_ausente") {
    try {
      await deps.afterAbsence(data);
    } catch (error) {
      // La reserva ya quedó cancelada y el reembolso en la cola: el barrido de reembolsos lo retoma.
      log("falló el reembolso por ausencia del docente: queda para el barrido", {
        bookingId: item.id,
        reason: error instanceof Error ? error.message : "desconocido",
      });
    }
  }
  return parsed.data.outcome;
}

export type AttendanceReport = Partial<Record<AttendanceOutcome, number>>;

/** Registra varias, de a una (en orden). */
export async function settleAttendanceFor(deps: AttendanceDeps, items: AwaitingClass[]): Promise<AttendanceReport> {
  const report: AttendanceReport = {};
  for (const item of items) {
    const outcome = await settleClassAttendance(deps, item);
    report[outcome] = (report[outcome] ?? 0) + 1;
  }
  return report;
}

const awaitingRowSchema = z.object({
  booking_id: z.string(),
  student_id: z.string(),
  tutor_id: z.string(),
  starts_at: z.string(),
  ends_at: z.string(),
});

/** Todas las clases terminadas que esperan su asistencia (para el cron), de la más vieja a la más nueva. */
export async function listAwaitingAttendance(admin: Pick<SupabaseClient, "rpc">, limit = 25): Promise<AwaitingClass[]> {
  const { data, error } = await admin.rpc("classes_awaiting_attendance", { p_limit: limit });
  if (error || !Array.isArray(data)) return [];
  return data.flatMap((row) => {
    const parsed = awaitingRowSchema.safeParse(row);
    if (!parsed.success) return [];
    const { booking_id, student_id, tutor_id, starts_at, ends_at } = parsed.data;
    return [{ id: booking_id, studentId: student_id, tutorId: tutor_id, startsAt: starts_at, endsAt: ends_at }];
  });
}

/**
 * Las clases terminadas de una persona que esperan su asistencia, leídas con SU sesión (la RLS filtra). Para
 * ponerlas al día cuando abre su panel o la sala.
 */
export async function listViewerAwaitingAttendance(
  supabase: Pick<SupabaseClient, "from">,
  viewer: { id: string; role: "alumno" | "docente" },
  { now = new Date(), limit = 3 }: { now?: Date; limit?: number } = {},
): Promise<AwaitingClass[]> {
  const { data, error } = await supabase
    .from("bookings")
    // Una confirmada terminada todavía no tiene asistencia: al registrarla deja de estar confirmada.
    .select("id, student_id, tutor_id, starts_at, ends_at")
    .eq(viewer.role === "alumno" ? "student_id" : "tutor_id", viewer.id)
    .eq("status", "confirmada")
    .lte("ends_at", now.toISOString())
    .order("ends_at", { ascending: true })
    .limit(limit);
  if (error || !Array.isArray(data)) return [];
  return data.flatMap((row) => {
    const parsed = awaitingRowSchema.omit({ booking_id: true }).extend({ id: z.string() }).safeParse(row);
    if (!parsed.success) return [];
    const { id, student_id, tutor_id, starts_at, ends_at } = parsed.data;
    return [{ id, studentId: student_id, tutorId: tutor_id, startsAt: starts_at, endsAt: ends_at }];
  });
}
