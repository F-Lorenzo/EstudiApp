import { redirect } from "next/navigation";
import { Catalogue } from "@/components/catalogue";
import { createClient } from "@/lib/supabase/server";
import { CATALOG_PAGE_SIZE, searchTutorCatalog } from "@/lib/tutors/catalog";
import {
  catalogQueryString,
  parseCatalogFilters,
  type CatalogSearchParams,
} from "@/lib/tutors/filters";
import { teacherFromCatalogRow } from "@/lib/tutors/view";

export const metadata = { title: "Encontrá tu profe" };

export default async function CatalogoDocentesPage({
  searchParams,
}: {
  searchParams: Promise<CatalogSearchParams>;
}) {
  const filters = parseCatalogFilters(await searchParams);
  const supabase = await createClient();

  const [tutors, subjects] = await Promise.all([
    searchTutorCatalog(supabase, {
      q: filters.q,
      materias: filters.materias,
      precioMax: filters.precioMax ?? undefined,
      disponibilidad: filters.disponibilidad,
      orden: filters.orden,
      pagina: filters.pagina,
    }),
    supabase.from("subjects").select("name").order("name"),
  ]);

  const total = tutors.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / CATALOG_PAGE_SIZE));
  // Una página que ya no existe (se aprobaron menos docentes, un enlace viejo): a la última que sí.
  if (tutors.data && filters.pagina > totalPages) {
    redirect(`/docentes${catalogQueryString({ ...filters, pagina: totalPages })}`);
  }

  return (
    <Catalogue
      teachers={(tutors.data?.rows ?? []).map(teacherFromCatalogRow)}
      total={total}
      totalPages={totalPages}
      subjects={(subjects.data ?? []).map((subject) => subject.name)}
      filters={filters}
      loadFailed={Boolean(tutors.error)}
    />
  );
}
