import { redirect } from "next/navigation";
import { StudentDashboard } from "@/components/student-dashboard";
import { getViewer } from "@/lib/auth/viewer";
import {
  getCompletedClasses,
  getUpcomingClasses,
} from "@/lib/bookings/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Mi espacio" };

export default async function AlumnoInicioPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");

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
