import { notFound, redirect } from "next/navigation";
import { Classroom } from "@/components/student-classroom";
import { getViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Tu clase" };

type BookingRoomRow = {
  tutor_profiles: {
    profiles: { full_name: string; avatar_url: string | null } | null;
  } | null;
};

export default async function SalaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const viewer = await getViewer();
  if (!viewer) redirect("/login");

  // Solo la persona que reservó puede abrir la sala de su clase.
  const supabase = await createClient();
  const { data: booking } = await supabase
    .from("bookings")
    .select("tutor_profiles!inner(profiles(full_name, avatar_url))")
    .eq("id", id)
    .eq("student_id", viewer.id)
    // Una reserva sin pagar o cancelada no abre la sala.
    .in("status", ["confirmada", "completada"])
    .single<BookingRoomRow>();

  if (!booking) notFound();

  const tutor = booking.tutor_profiles?.profiles;
  return (
    <Classroom
      teacherName={tutor?.full_name || "Docente"}
      teacherPhoto={tutor?.avatar_url ?? null}
      studentName={viewer.name}
    />
  );
}
