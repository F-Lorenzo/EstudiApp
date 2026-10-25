import { redirect } from "next/navigation";
import {
  ClassListError,
  HistoryRow,
  NoHistory,
} from "@/components/student-dashboard";
import { PageHeading } from "@/components/ui";
import { getViewer } from "@/lib/auth/viewer";
import { getCompletedClasses } from "@/lib/bookings/queries";
import { createClient } from "@/lib/supabase/server";
import { syncViewerAttendance } from "@/lib/video/attendance-runtime";

export const metadata = { title: "Historial" };

export default async function HistorialPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");

  // Antes de leer: las clases que terminaron se completan (o se reembolsan) según la asistencia a la sala.
  await syncViewerAttendance(viewer);
  const supabase = await createClient();
  const { classes, error } = await getCompletedClasses(supabase, viewer.id);

  return (
    <div className="stu-page">
      <PageHeading
        eyebrow="MIS CLASES"
        title="Tu recorrido."
        description="Las clases que ya completaste, de la más reciente a la más antigua."
      />
      <section className="stu-class-list">
        {error ? (
          <ClassListError />
        ) : classes.length ? (
          classes.map((item) => <HistoryRow key={item.id} item={item} />)
        ) : (
          <NoHistory />
        )}
      </section>
    </div>
  );
}
