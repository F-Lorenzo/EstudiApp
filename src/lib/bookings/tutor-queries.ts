import type { SupabaseClient } from "@supabase/supabase-js";

type ScoreEmbed = { score: number } | { score: number }[] | null;

type TutorBookingRow = {
  id: string;
  availability_slots: { starts_at: string; ends_at: string } | null;
  ratings?: ScoreEmbed;
};

/**
 * Clase de un docente. No incluye el nombre del alumno: la RLS actual de
 * `profiles` no deja que un docente lea el perfil de sus alumnos.
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
  const { data, error } = await supabase
    .from("bookings")
    .select("id, availability_slots!inner(starts_at, ends_at), ratings(score)")
    .eq("tutor_id", tutorId)
    .eq("status", status)
    .returns<TutorBookingRow[]>();

  const classes = (data ?? []).flatMap((row): TutorClass[] => {
    if (!row.availability_slots) return [];
    const rating = Array.isArray(row.ratings) ? row.ratings[0] : row.ratings;
    return [
      {
        id: row.id,
        startsAt: row.availability_slots.starts_at,
        endsAt: row.availability_slots.ends_at,
        score: rating?.score ?? null,
      },
    ];
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
