import type { SupabaseClient } from "@supabase/supabase-js";
import { syncBookings } from "@/lib/bookings/sync";

type ScoreEmbed = { score: number } | { score: number }[] | null;

type TutorBookingRow = {
  id: string;
  starts_at: string;
  ends_at: string;
  ratings?: ScoreEmbed;
};

/**
 * Clase de un docente. Todavía no incluye el nombre del alumno aunque la RLS ya
 * se lo deja leer (migración 0008): falta mostrarlo en el panel del docente.
 */
export type TutorClass = {
  id: string;
  startsAt: string;
  endsAt: string;
  score: number | null;
};

export async function getTutorClasses(
  supabase: SupabaseClient,
  tutorId: string,
  status: "confirmada" | "completada",
) {
  await syncBookings(supabase);
  const { data, error } = await supabase
    .from("bookings")
    .select("id, starts_at, ends_at, ratings(score)")
    .eq("tutor_id", tutorId)
    .eq("status", status)
    .returns<TutorBookingRow[]>();

  const classes = (data ?? []).map((row): TutorClass => {
    const rating = Array.isArray(row.ratings) ? row.ratings[0] : row.ratings;
    return {
      id: row.id,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      score: rating?.score ?? null,
    };
  });

  classes.sort((a, b) =>
    status === "confirmada"
      ? a.startsAt.localeCompare(b.startsAt)
      : b.startsAt.localeCompare(a.startsAt),
  );
  return { classes, error };
}

/** Próximo horario libre que publicó el docente, o `null`. */
export async function getNextOpenSlot(
  supabase: SupabaseClient,
  tutorId: string,
) {
  await syncBookings(supabase);
  const { data } = await supabase
    .from("availability_slots")
    .select("starts_at")
    .eq("tutor_id", tutorId)
    .eq("is_booked", false)
    .gt("starts_at", new Date().toISOString())
    .order("starts_at")
    .limit(1)
    .returns<{ starts_at: string }[]>();
  return data?.[0]?.starts_at ?? null;
}
