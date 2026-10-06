import { ActiveTeachers } from "@/components/admin-pages";
import { EmptyState } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { listTutorsByStatus, toAdminRow } from "@/lib/tutors/queries";

export const metadata = { title: "Comunidad docente" };

export default async function DocentesActivosPage() {
  const supabase = await createClient();
  const { data, error } = await listTutorsByStatus(supabase, "aprobado");

  if (error)
    return (
      <div className="mgmt-page">
        <EmptyState
          title="No pudimos cargar los docentes."
          description="Hubo un problema de nuestro lado. Actualizá la página en un momento."
        />
      </div>
    );

  return <ActiveTeachers rows={(data ?? []).map(toAdminRow)} />;
}
