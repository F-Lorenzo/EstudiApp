import { RejectedTeachers } from "@/components/admin-pages";
import { EmptyState } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { listTutorsByStatus, toAdminRow } from "@/lib/tutors/queries";

export const metadata = { title: "Perfiles rechazados" };

export default async function DocentesRechazadosPage() {
  const supabase = await createClient();
  const { data, error } = await listTutorsByStatus(supabase, "rechazado");

  if (error)
    return (
      <div className="mgmt-page">
        <EmptyState
          title="No pudimos cargar los perfiles rechazados."
          description="Hubo un problema de nuestro lado. Actualizá la página en un momento."
        />
      </div>
    );

  return <RejectedTeachers rows={(data ?? []).map(toAdminRow)} />;
}
