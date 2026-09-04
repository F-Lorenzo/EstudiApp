import type { SupabaseClient } from "@supabase/supabase-js";

export type TutorCatalogRow = {
  id: string;
  full_name: string;
  avatar_url: string | null;
  bio: string;
  tarifa_por_clase: number;
  rating_promedio: number;
  subject_names: string[];
  has_availability: boolean;
};

export type CatalogFilters = {
  q?: string;
  materia?: string;
  precioMin?: number;
  precioMax?: number;
  disponibilidad?: boolean;
};

export async function searchTutorCatalog(
  supabase: SupabaseClient,
  filters: CatalogFilters,
) {
  let query = supabase.from("tutor_catalog").select("*");

  if (filters.q) {
    query = query.ilike("search_text", `%${filters.q.toLowerCase()}%`);
  }

  if (filters.materia) {
    query = query.contains("subject_names", [filters.materia]);
  }

  if (filters.precioMin != null) {
    query = query.gte("tarifa_por_clase", filters.precioMin);
  }

  if (filters.precioMax != null) {
    query = query.lte("tarifa_por_clase", filters.precioMax);
  }

  if (filters.disponibilidad) {
    query = query.eq("has_availability", true);
  }

  return query
    .order("rating_promedio", { ascending: false })
    .returns<TutorCatalogRow[]>();
}
