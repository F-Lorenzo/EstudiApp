import { AuditLog } from "@/components/admin-pages";
import { EmptyState } from "@/components/ui";
import { listAuditLog } from "@/lib/admin/audit";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Registro de acciones" };

export default async function RegistroPage() {
  const supabase = await createClient();
  const { entries, error } = await listAuditLog(supabase, { limit: 100 });

  if (error)
    return (
      <div className="mgmt-page">
        <EmptyState
          title="No pudimos cargar el registro."
          description="Hubo un problema de nuestro lado. Actualizá la página en un momento."
        />
      </div>
    );

  return <AuditLog entries={entries} />;
}
