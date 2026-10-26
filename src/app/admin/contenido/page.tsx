import { ContentManager } from "@/components/admin-content";
import { EmptyState } from "@/components/ui";
import { getSiteContentRow } from "@/lib/content/site-content";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Contenido" };

export default async function ContenidoPage() {
  const supabase = await createClient();
  const content = await getSiteContentRow(supabase);

  if (!content)
    return (
      <div className="mgmt-page">
        <EmptyState
          title="No pudimos cargar el contenido del sitio."
          description="Hubo un problema de nuestro lado. Actualizá la página en un momento."
        />
      </div>
    );

  return <ContentManager content={content} />;
}
