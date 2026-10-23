import type { SupabaseClient } from "@supabase/supabase-js";
import { syncBookings } from "@/lib/bookings/sync";

type ScoreEmbed = { score: number } | { score: number }[] | null;
type StudentEmbed = { full_name: string | null; avatar_url: string | null };

type TutorBookingRow = {
  id: string;
  starts_at: string;
  ends_at: string;
  ratings?: ScoreEmbed;
  profiles?: StudentEmbed | StudentEmbed[] | null;
};

/** Nombre que se muestra si el alumno no cargó el suyo (o la base no lo devolvió). */
export const STUDENT_FALLBACK_NAME = "Estudiante";

/**
 * Clase de un docente, con el nombre y la foto del alumno. Son los únicos datos del alumno que ve el
 * docente (decisión del 23 de octubre de 2026); la RLS se los deja leer solo de sus propios alumnos
 * (`profiles_select_student_of_tutor`, migración 0008).
 */
export type TutorClass = {
  id: string;
  startsAt: string;
  endsAt: string;
  score: number | null;
  studentName: string;
  studentPhoto: string | null;
};

export async function getTutorClasses(
  supabase: SupabaseClient,
  tutorId: string,
  status: "confirmada" | "completada",
) {
  await syncBookings(supabase);
  const { data, error } = await supabase
    .from("bookings")
    .select("id, starts_at, ends_at, ratings(score), profiles(full_name, avatar_url)")
    .eq("tutor_id", tutorId)
    .eq("status", status)
    .returns<TutorBookingRow[]>();

  const classes = (data ?? []).map((row): TutorClass => {
    const rating = Array.isArray(row.ratings) ? row.ratings[0] : row.ratings;
    const student = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    return {
      id: row.id,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      score: rating?.score ?? null,
      studentName: student?.full_name?.trim() || STUDENT_FALLBACK_NAME,
      studentPhoto: student?.avatar_url || null,
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
