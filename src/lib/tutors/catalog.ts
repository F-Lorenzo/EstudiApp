import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
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

/** Docentes por página del catálogo. La base acepta hasta 48. */
export const CATALOG_PAGE_SIZE = 10;

export type CatalogFilters = {
  q?: string;
  /** Docentes que den al menos una de estas materias. */
  materias?: string[];
  precioMin?: number;
  precioMax?: number;
  disponibilidad?: boolean;
  orden?: CatalogOrder;
  /** Desde 1. */
  pagina?: number;
};

const amount = z.union([z.number(), z.string()]).transform(Number).pipe(z.number().nonnegative());

const catalogPageSchema = z.object({
  total: amount.pipe(z.number().int()),
  rows: z.array(
    z.object({
      id: z.string(),
      full_name: z.string(),
      avatar_url: z.string().nullable(),
      bio: z.string(),
      tarifa_por_clase: amount,
      rating_promedio: amount,
      subject_names: z.array(z.string()),
      has_availability: z.boolean(),
    }),
  ),
});

export type CatalogPage = { total: number; rows: TutorCatalogRow[] };

/**
 * Una página del catálogo con el total de resultados (`search_tutor_catalog`, migración 0025). La base resuelve
 * todo: el texto sin tildes ni mayúsculas, cada palabra en el nombre o en alguna materia, los filtros, el orden
 * y la página. «Con horarios disponibles» quiere decir que hay un horario que se puede reservar.
 */
export async function searchTutorCatalog(
  supabase: SupabaseClient,
  filters: CatalogFilters,
): Promise<{ data: CatalogPage | null; error: unknown }> {
  // «Con horarios disponibles» no debe contar horarios retenidos por reservas vencidas.
  await syncBookings(supabase);
  const pagina = Math.max(1, Math.floor(filters.pagina ?? 1));
  const { data, error } = await supabase.rpc("search_tutor_catalog", {
    p_q: filters.q?.trim() || null,
    p_materias: filters.materias?.length ? filters.materias : null,
    p_precio_min: filters.precioMin ?? null,
    p_precio_max: filters.precioMax ?? null,
    p_disponibilidad: Boolean(filters.disponibilidad),
    p_orden: filters.orden ?? "calificacion",
    p_limit: CATALOG_PAGE_SIZE,
    p_offset: (pagina - 1) * CATALOG_PAGE_SIZE,
  });
  if (error) return { data: null, error };
  const parsed = catalogPageSchema.safeParse(data);
  if (!parsed.success) return { data: null, error: parsed.error };
  return { data: parsed.data, error: null };
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
