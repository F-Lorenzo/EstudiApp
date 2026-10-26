import { createHash } from "node:crypto";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { headers } from "next/headers";
import { runtimeEnv } from "@/lib/runtime-env";
import { isRateLimiter, withinRateLimit, type RateLimiter } from "./rate-limit";
import { verifyTurnstile } from "./turnstile";

/**
 * Control antes del login, el registro y la recuperación de contraseña (decisión del 26 de octubre de 2026):
 * primero el límite por IP (y, en el login, por email), después Turnstile. Devuelve el mensaje para la persona o
 * `null` si puede seguir.
 *
 *   login       10 por minuto por IP y 10 por minuto por email (LOGIN_RATE_LIMITER)
 *   registro    5 por minuto por IP (SIGNUP_RATE_LIMITER)
 *   recuperar   5 por minuto por IP (SIGNUP_RATE_LIMITER)
 */
export type AuthGuardKind = "login" | "registro" | "recuperar";

export const TURNSTILE_FIELD = "cf-turnstile-response";

const TOO_MANY = "Hiciste muchos intentos seguidos. Esperá un minuto y probá de nuevo.";
const CHALLENGE = "No pudimos comprobar que no seas un robot. Probá de nuevo.";

export async function guardAuthRequest(
  kind: AuthGuardKind,
  formData: FormData,
  { email }: { email?: string } = {},
): Promise<string | null> {
  const ip = clientIp(await headers());
  const limiter = rateLimiter(kind === "login" ? "LOGIN_RATE_LIMITER" : "SIGNUP_RATE_LIMITER");
  const keys = [`${kind}:${ip ?? "sin-ip"}`];
  // El email va con hash: la clave del limitador no tiene por qué llevar datos personales.
  if (kind === "login" && email) keys.push(`login-email:${createHash("sha256").update(email.trim().toLowerCase()).digest("hex")}`);
  if (!(await withinRateLimit(limiter, keys))) return TOO_MANY;

  // Turnstile se exige solo con las DOS claves: con la secreta y sin la pública, el formulario no mostraría el
  // widget y nadie podría ingresar.
  const env = runtimeEnv();
  const turnstile = await verifyTurnstile({
    secret: env.TURNSTILE_SITE_KEY?.trim() ? env.TURNSTILE_SECRET_KEY : undefined,
    token: formData.get(TURNSTILE_FIELD),
    ip,
    action: kind,
  });
  return turnstile.ok ? null : CHALLENGE;
}

/** La IP de la persona: la pone Cloudflare (`cf-connecting-ip`); en desarrollo, la primera de `x-forwarded-for`. */
export function clientIp(h: Pick<Headers, "get">): string | null {
  const ip = h.get("cf-connecting-ip")?.trim() || h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return ip && ip.length <= 64 ? ip : null;
}

function rateLimiter(name: string): RateLimiter | null {
  try {
    const binding = (getCloudflareContext().env as unknown as Record<string, unknown>)[name];
    return isRateLimiter(binding) ? binding : null;
  } catch {
    // Fuera de un Worker (pruebas, `next dev`) no hay limitador.
    return null;
  }
}
