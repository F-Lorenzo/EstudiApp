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

export const metadata = { title: "Próximas clases" };

export default async function ProximasClasesPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");

  const supabase = await createClient();
  const { classes, error } = await getUpcomingClasses(supabase, viewer.id);

  return (
    <div className="stu-page">
      <PageHeading
        eyebrow="MIS CLASES"
        title="Próximas clases."
        description="Tus reservas confirmadas, en orden."
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
