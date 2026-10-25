import { redirect } from "next/navigation";
import {
  ClassListError,
  NoUpcoming,
  UpcomingRow,
} from "@/components/student-dashboard";
import { PageHeading } from "@/components/ui";
import { getViewer } from "@/lib/auth/viewer";
import { getUpcomingClasses } from "@/lib/bookings/queries";
import { createClient } from "@/lib/supabase/server";
import { syncViewerAttendance } from "@/lib/video/attendance-runtime";

export const metadata = { title: "Próximas clases" };

export default async function ProximasClasesPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");

  // Antes de leer: las clases que terminaron se completan (o se reembolsan) según la asistencia a la sala.
  await syncViewerAttendance(viewer);
  const supabase = await createClient();
  const { classes, error } = await getUpcomingClasses(supabase, viewer.id);

  return (
    <div className="stu-page">
      <PageHeading
        eyebrow="MIS CLASES"
        title="Próximas clases."
        description="Tus reservas, en orden. Las que faltan pagar vencen a los 15 minutos."
      />
      <section className="stu-class-list">
        {error ? (
          <ClassListError />
        ) : classes.length ? (
          classes.map((item) => <UpcomingRow key={item.id} item={item} />)
        ) : (
          <NoUpcoming />
        )}
      </section>
    </div>
  );
}
