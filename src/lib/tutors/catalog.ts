import type { SupabaseClient } from "@supabase/supabase-js";
import { syncBookings } from "@/lib/bookings/sync";

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

export type CatalogOrder = "calificacion" | "precio";

export type CatalogFilters = {
  q?: string;
  /** Docentes que den al menos una de estas materias. */
  materias?: string[];
  precioMin?: number;
  precioMax?: number;
  disponibilidad?: boolean;
  orden?: CatalogOrder;
};

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export async function searchTutorCatalog(
  supabase: SupabaseClient,
  filters: CatalogFilters,
) {
  // «Con horarios disponibles» no debe contar horarios retenidos por reservas vencidas.
  await syncBookings(supabase);
  let query = supabase.from("tutor_catalog").select("*");

  if (filters.materias?.length) {
    query = query.overlaps("subject_names", filters.materias);
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

  if (filters.orden === "precio") {
    query = query.order("tarifa_por_clase", { ascending: true });
  }
  // `id` desempata: con muchos docentes en la misma calificación el orden
  // tiene que ser estable entre consultas.
  query = query
    .order("rating_promedio", { ascending: false })
    .order("id");

  const { data, error } = await query.returns<TutorCatalogRow[]>();

  // La búsqueda de texto ignora mayúsculas y tildes («fisica» encuentra
  // «Física»). Se resuelve acá y no con `ilike` en la vista porque la base
  // no tiene `unaccent`; con un catálogo grande conviene moverla a SQL.
  const needle = filters.q ? normalize(filters.q.trim()) : "";
  return {
    data:
      data && needle
        ? data.filter((row) =>
            normalize(`${row.full_name} ${row.subject_names.join(" ")}`).includes(
              needle,
            ),
          )
        : data,
    error,
  };
}

/** Docentes mejor calificados, para la Home. */
export async function getFeaturedTutors(
  supabase: SupabaseClient,
  limit = 3,
) {
  return supabase
    .from("tutor_catalog")
    .select("*")
    .order("rating_promedio", { ascending: false })
    .order("id")
    .limit(limit)
    .returns<TutorCatalogRow[]>();
}
