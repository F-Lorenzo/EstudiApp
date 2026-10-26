/**
 * Límite de pedidos por minuto con el limitador nativo de Cloudflare Workers (bindings `ratelimits` de
 * `wrangler.jsonc`). Cuenta por clave («login:<ip>») en cada ubicación de Cloudflare: frena la fuerza bruta y los
 * robots simples, no es una cuenta exacta. Las reglas que mueven dinero tienen su propio tope en la base (0024).
 *
 * Sin el binding (desarrollo, pruebas) o si el limitador falla, deja pasar: un problema del limitador no puede
 * dejar a nadie afuera del login.
 */
export type RateLimiter = { limit(options: { key: string }): Promise<{ success: boolean }> };

export function isRateLimiter(value: unknown): value is RateLimiter {
  return typeof value === "object" && value !== null && typeof (value as RateLimiter).limit === "function";
}

/** `true` si TODAS las claves están dentro del límite. Se cuentan todas, aunque una ya se haya pasado. */
export async function withinRateLimit(
  limiter: RateLimiter | null,
  keys: string[],
  log: (message: string) => void = (message) => console.error(JSON.stringify({ source: "rate-limit", message })),
): Promise<boolean> {
  if (!limiter) return true;
  try {
    const results = await Promise.all(keys.map((key) => limiter.limit({ key })));
    return results.every((result) => result.success);
  } catch {
    log("el limitador falló; se deja pasar el pedido");
    return true;
  }
}
