import { redirect } from "next/navigation";
import { StudentDashboard } from "@/components/student-dashboard";
import { getViewer } from "@/lib/auth/viewer";
import {
  getCompletedClasses,
  getUpcomingClasses,
} from "@/lib/bookings/queries";
import { createClient } from "@/lib/supabase/server";
import { syncViewerAttendance } from "@/lib/video/attendance-runtime";

export const metadata = { title: "Mi espacio" };

export default async function AlumnoInicioPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");

  // Antes de leer: las clases que terminaron se completan (o se reembolsan) según la asistencia a la sala.
  await syncViewerAttendance(viewer);
  const supabase = await createClient();
  const [upcoming, completed] = await Promise.all([
    getUpcomingClasses(supabase, viewer.id),
    getCompletedClasses(supabase, viewer.id),
  ]);

  return (
    <StudentDashboard
      firstName={viewer.name.split(" ")[0]}
      upcoming={upcoming.classes}
      completed={completed.classes}
      loadFailed={Boolean(upcoming.error || completed.error)}
    />
  );
}
