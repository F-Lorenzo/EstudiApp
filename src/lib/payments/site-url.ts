/**
 * Dirección pública de la app (`NEXT_PUBLIC_SITE_URL`), sin barra final. Se usa para armar las
 * direcciones que Mercado Pago (y los emails) necesitan completas y fijas: la de retorno del OAuth,
 * la de los avisos (webhook) y las de regreso del checkout.
 *
 * Lanza si falta o no es válida: una dirección de retorno armada con lo que venga en la cabecera de
 * la petición se puede falsificar, así que no se usa de reemplazo.
 */
export function siteUrl(env: Record<string, string | undefined> = process.env): string {
  const raw = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!raw) throw new Error("Falta NEXT_PUBLIC_SITE_URL.");

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("NEXT_PUBLIC_SITE_URL no es una dirección válida.");
  }
  // Mercado Pago exige https para el retorno del OAuth y los avisos. En desarrollo se acepta http://localhost.
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("NEXT_PUBLIC_SITE_URL tiene que ser https (o http://localhost en desarrollo).");
  }
  return url.origin;
}

/** Variante que no lanza: `null` si la dirección no está bien configurada. */
export function siteUrlOrNull(env: Record<string, string | undefined> = process.env): string | null {
  try {
    return siteUrl(env);
  } catch {
    return null;
  }
}
