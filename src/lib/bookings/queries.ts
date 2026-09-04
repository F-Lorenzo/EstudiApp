import type { SupabaseClient } from "@supabase/supabase-js";

export type StudentBookingRow = {
  id: string;
  status: string;
  availability_slots: { starts_at: string; ends_at: string } | null;
  tutor_profiles: { profiles: { full_name: string } | null } | null;
};

// Reservas confirmadas del alumno, próximas primero (sección 3 y 13).
export async function getUpcomingBookings(
  supabase: SupabaseClient,
  studentId: string,
) {
  return supabase
    .from("bookings")
    .select(
      "id, status, availability_slots!inner(starts_at, ends_at), tutor_profiles!inner(profiles(full_name))",
    )
    .eq("student_id", studentId)
    .eq("status", "confirmada")
    .order("starts_at", { referencedTable: "availability_slots" })
    .returns<StudentBookingRow[]>();
}

// Historial de clases completadas del alumno, más recientes primero.
export async function getCompletedBookings(
  supabase: SupabaseClient,
  studentId: string,
) {
  return supabase
    .from("bookings")
    .select(
      "id, status, availability_slots!inner(starts_at, ends_at), tutor_profiles!inner(profiles(full_name))",
    )
    .eq("student_id", studentId)
    .eq("status", "completada")
    .order("starts_at", { referencedTable: "availability_slots", ascending: false })
    .returns<StudentBookingRow[]>();
}
