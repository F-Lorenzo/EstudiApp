import type { SupabaseClient } from "@supabase/supabase-js";

type ScoreEmbed = { score: number } | { score: number }[] | null;

export type StudentBookingRow = {
  id: string;
  status: string;
  tutor_id: string;
  availability_slots: { starts_at: string; ends_at: string } | null;
  tutor_profiles: {
    profiles: { full_name: string; avatar_url: string | null } | null;
  } | null;
  ratings?: ScoreEmbed;
};

/** Clase lista para mostrar en la interfaz. */
export type ClassItem = {
  id: string;
  status: string;
  startsAt: string;
  endsAt: string;
  tutorId: string;
  tutorName: string;
  tutorPhoto: string | null;
  /** Calificación que dejó el alumno, si ya calificó. */
  score: number | null;
};

const SELECT_STUDENT =
  "id, status, tutor_id, availability_slots!inner(starts_at, ends_at), tutor_profiles!inner(profiles(full_name, avatar_url)), ratings(score)";

function toClassItem(row: StudentBookingRow): ClassItem | null {
  if (!row.availability_slots) return null;
  const rating = Array.isArray(row.ratings) ? row.ratings[0] : row.ratings;
  return {
    id: row.id,
    status: row.status,
    startsAt: row.availability_slots.starts_at,
    endsAt: row.availability_slots.ends_at,
    tutorId: row.tutor_id,
    tutorName: row.tutor_profiles?.profiles?.full_name || "Docente",
    tutorPhoto: row.tutor_profiles?.profiles?.avatar_url ?? null,
    score: rating?.score ?? null,
  };
}

async function listStudentClasses(
  supabase: SupabaseClient,
  studentId: string,
  status: "confirmada" | "completada",
) {
  const { data, error } = await supabase
    .from("bookings")
    .select(SELECT_STUDENT)
    .eq("student_id", studentId)
    .eq("status", status)
    .returns<StudentBookingRow[]>();

  return {
    error,
    classes: (data ?? [])
      .map(toClassItem)
      .filter((item): item is ClassItem => item !== null),
  };
}

// Reservas confirmadas del alumno, próximas primero (sección 3 y 13).
export async function getUpcomingClasses(
  supabase: SupabaseClient,
  studentId: string,
) {
  const { classes, error } = await listStudentClasses(
    supabase,
    studentId,
    "confirmada",
  );
  return {
    error,
    classes: classes.sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
  };
}

// Historial de clases completadas del alumno, más recientes primero.
export async function getCompletedClasses(
  supabase: SupabaseClient,
  studentId: string,
) {
  const { classes, error } = await listStudentClasses(
    supabase,
    studentId,
    "completada",
  );
  return {
    error,
    classes: classes.sort((a, b) => b.startsAt.localeCompare(a.startsAt)),
  };
}
