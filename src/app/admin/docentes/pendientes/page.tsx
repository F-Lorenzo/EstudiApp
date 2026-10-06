import { PendingTeachers } from "@/components/admin-pages";
import { EmptyState } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { listTutorsByStatus, toAdminRow } from "@/lib/tutors/queries";

export const metadata = { title: "Solicitudes docentes" };

export default async function DocentesPendientesPage() {
  const supabase = await createClient();
  const { data, error } = await listTutorsByStatus(supabase, "pendiente");

  if (error)
    return (
      <div className="mgmt-page">
        <EmptyState
          title="No pudimos cargar las solicitudes."
          description="Hubo un problema de nuestro lado. Actualizá la página en un momento."
        />
      </div>
    );

  return <PendingTeachers rows={(data ?? []).map(toAdminRow)} />;
}
