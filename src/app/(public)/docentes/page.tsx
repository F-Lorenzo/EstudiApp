import { Catalogue } from "@/components/catalogue";
import { createClient } from "@/lib/supabase/server";
import { searchTutorCatalog } from "@/lib/tutors/catalog";
import {
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
    }),
    supabase.from("subjects").select("name").order("name"),
  ]);

  return (
    <Catalogue
      teachers={(tutors.data ?? []).map(teacherFromCatalogRow)}
      subjects={(subjects.data ?? []).map((subject) => subject.name)}
      filters={filters}
      loadFailed={Boolean(tutors.error)}
    />
  );
}
