import type { CatalogOrder } from "./catalog";

/** Rango del control de precio del catálogo (ARS por clase). */
export const PRICE_FLOOR = 5000;
export const PRICE_CEILING = 30000;

/** Filtros del catálogo tal como viven en la URL. */
export type CatalogUiFilters = {
  q: string;
  materias: string[];
  /** `null` = sin tope de precio. */
  precioMax: number | null;
  disponibilidad: boolean;
  orden: CatalogOrder;
};

export type CatalogSearchParams = {
  q?: string | string[];
  materia?: string | string[];
  precioMax?: string;
  disponibilidad?: string;
  orden?: string;
};

export function parseCatalogFilters(
  params: CatalogSearchParams,
): CatalogUiFilters {
  const materias = (
    Array.isArray(params.materia)
      ? params.materia
      : params.materia
        ? [params.materia]
        : []
  ).filter(Boolean);
  const max = Number(params.precioMax);
  // Una clave repetida en la URL llega como arreglo: se usa la primera.
  const q = Array.isArray(params.q) ? params.q[0] : params.q;
  return {
    q: q?.trim() ?? "",
    materias,
    precioMax:
      Number.isFinite(max) && max >= PRICE_FLOOR && max < PRICE_CEILING
        ? max
        : null,
    disponibilidad: params.disponibilidad === "on",
    orden: params.orden === "precio" ? "precio" : "calificacion",
  };
}

export function catalogQueryString(filters: CatalogUiFilters) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  filters.materias.forEach((materia) => params.append("materia", materia));
  if (filters.precioMax != null)
    params.set("precioMax", String(filters.precioMax));
  if (filters.disponibilidad) params.set("disponibilidad", "on");
  if (filters.orden !== "calificacion") params.set("orden", filters.orden);
  const query = params.toString();
  return query ? `?${query}` : "";
}
