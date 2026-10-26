import { siteUrlOrNull } from "@/lib/payments/site-url";

/**
 * ¿Pueden los buscadores indexar el sitio? (decisión del 26 de octubre de 2026: un interruptor, apagado hasta el
 * lanzamiento). Se enciende con `SITE_INDEXABLE=true` en las variables del Worker, sin volver a desplegar: los
 * metadatos (`robots`), `robots.txt` y `sitemap.xml` se arman en cada pedido.
 *
 * Hace falta además que la dirección del sitio (`NEXT_PUBLIC_SITE_URL`) sea https y pública, y que el pedido venga
 * a esa misma dirección: una versión de prueba (otra dirección del Worker) nunca se indexa.
 */
export function siteIndexable(env: Record<string, string | undefined>, requestHost: string | null): boolean {
  if (env.SITE_INDEXABLE?.trim().toLowerCase() !== "true") return false;
  const site = siteUrlOrNull(env);
  if (!site) return false;
  const url = new URL(site);
  if (url.protocol !== "https:") return false;
  return requestHost?.trim().toLowerCase() === url.host;
}

/** Áreas privadas: nunca se indexan. «/docente» va con `$` para no bloquear el catálogo público «/docentes». */
export const PRIVATE_PATHS = ["/admin", "/alumno", "/docente$", "/docente/", "/api/", "/auth/"];

/** Páginas públicas fijas del mapa del sitio (las de cada docente se suman aparte). */
export const PUBLIC_PATHS = ["/", "/docentes", "/como-funciona", "/registro/alumno", "/registro/docente", "/terminos", "/privacidad", "/cancelacion"];
