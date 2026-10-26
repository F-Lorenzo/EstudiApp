import { CommissionAdmin } from "@/components/admin-commission";
import { EmptyState } from "@/components/ui";
import { getCommissionConfig } from "@/lib/admin/commission";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Comisión" };

export default async function ComisionPage() {
  const supabase = await createClient();
  const config = await getCommissionConfig(supabase);

  if (!config)
    return (
      <div className="mgmt-page">
        <EmptyState
          title="No pudimos cargar la comisión."
          description="Hubo un problema de nuestro lado. Actualizá la página en un momento."
        />
      </div>
    );

  return <CommissionAdmin {...config} />;
}
