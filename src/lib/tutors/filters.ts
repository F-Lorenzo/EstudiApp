import type { CatalogOrder } from "./catalog";

/** Rango del control de precio del catálogo (ARS por clase). */
export const PRICE_FLOOR = 5000;
export const PRICE_CEILING = 30000;
/** La base usa solo los primeros 100 caracteres de la búsqueda. */
export const SEARCH_MAX_LENGTH = 100;
/** Una página más alta se trata como la 1 (la página del servidor lleva a la última que exista). */
export const MAX_PAGE = 10000;

/** Filtros del catálogo tal como viven en la URL. */
export type CatalogUiFilters = {
  q: string;
  materias: string[];
  /** `null` = sin tope de precio. */
  precioMax: number | null;
  disponibilidad: boolean;
  orden: CatalogOrder;
  /** Desde 1. */
  pagina: number;
};

export type CatalogSearchParams = {
  q?: string | string[];
  materia?: string | string[];
  precioMax?: string;
  disponibilidad?: string;
  orden?: string;
  pagina?: string;
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
  const pagina = Number(params.pagina);
  return {
    q: q?.trim().slice(0, SEARCH_MAX_LENGTH).trim() ?? "",
    materias,
    precioMax:
      Number.isFinite(max) && max >= PRICE_FLOOR && max < PRICE_CEILING
        ? max
        : null,
    disponibilidad: params.disponibilidad === "on",
    orden: params.orden === "precio" ? "precio" : "calificacion",
    pagina: Number.isInteger(pagina) && pagina > 1 && pagina <= MAX_PAGE ? pagina : 1,
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
  if (filters.pagina > 1) params.set("pagina", String(filters.pagina));
  const query = params.toString();
  return query ? `?${query}` : "";
}

export type PageItem = number | "…";

/**
 * Los números de página que se muestran: la primera, la última y las vecinas de la actual, con «…» en los huecos
 * de más de una página (1 … 4 5 6 … 20).
 */
export function pageItems(current: number, totalPages: number): PageItem[] {
  const pages = new Set([1, totalPages, current - 1, current, current + 1]);
  const sorted = [...pages].filter((page) => page >= 1 && page <= totalPages).sort((a, b) => a - b);
  const items: PageItem[] = [];
  for (const page of sorted) {
    const previous = items.at(-1);
    if (typeof previous === "number" && page - previous === 2) items.push(previous + 1);
    else if (typeof previous === "number" && page - previous > 2) items.push("…");
    items.push(page);
  }
  return items;
}
