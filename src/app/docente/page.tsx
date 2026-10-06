import { redirect } from "next/navigation";
import { TeacherDashboard } from "@/components/teacher-dashboard";
import { getViewer } from "@/lib/auth/viewer";
import {
  getNextOpenSlot,
  getTutorClasses,
} from "@/lib/bookings/tutor-queries";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Espacio docente" };

export default async function DocenteInicioPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");

  const supabase = await createClient();
  const [{ data: tutor }, upcoming, completed, nextOpenSlot] =
    await Promise.all([
      supabase
        .from("tutor_profiles")
        .select("verification_status, verification_reason, rating_promedio")
        .eq("id", viewer.id)
        .single<{
          verification_status: string;
          verification_reason: string | null;
          rating_promedio: number;
        }>(),
      getTutorClasses(supabase, viewer.id, "confirmada"),
      getTutorClasses(supabase, viewer.id, "completada"),
      getNextOpenSlot(supabase, viewer.id),
    ]);

  return (
    <TeacherDashboard
      tutorId={viewer.id}
      status={tutor?.verification_status ?? "pendiente"}
      reason={tutor?.verification_reason ?? null}
      rating={Number(tutor?.rating_promedio) || 0}
      upcoming={upcoming.classes}
      completed={completed.classes}
      nextOpenSlot={nextOpenSlot}
      loadFailed={Boolean(upcoming.error || completed.error)}
    />
  );
}
