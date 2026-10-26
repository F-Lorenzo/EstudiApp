import { z } from "zod";

/**
 * Verificación de Cloudflare Turnstile en el servidor (https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).
 *
 *   TURNSTILE_SITE_KEY     clave pública del widget (se lee en el servidor y se pasa al formulario)
 *   TURNSTILE_SECRET_KEY   clave secreta (secreto del Worker)
 *
 * Sin la clave secreta (o sin la pública: ver `auth-guard.ts`), Turnstile está apagado y no se verifica nada (desarrollo, o hasta que se configure). Con
 * ella, un pedido sin token, con un token inválido, de otro formulario (`action`) o si Cloudflare no responde, NO
 * pasa: es lo que se espera de un control contra robots.
 */
const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TIMEOUT_MS = 5_000;

const responseSchema = z.object({
  success: z.boolean(),
  action: z.string().nullish(),
  "error-codes": z.array(z.string()).nullish(),
});

export type TurnstileResult =
  | { ok: true; skipped: boolean }
  | { ok: false; reason: "missing_token" | "invalid" | "wrong_action" | "unavailable" };

export async function verifyTurnstile({
  secret,
  token,
  ip,
  action,
  fetchImpl = (...args) => fetch(...args),
}: {
  secret: string | undefined;
  token: unknown;
  ip: string | null;
  /** El formulario del que tiene que venir el token («login», «registro», «recuperar»). */
  action: string;
  fetchImpl?: typeof fetch;
}): Promise<TurnstileResult> {
  const key = secret?.trim();
  if (!key) return { ok: true, skipped: true };
  if (typeof token !== "string" || !token.trim() || token.length > 2048) return { ok: false, reason: "missing_token" };

  const body = new URLSearchParams({ secret: key, response: token });
  if (ip) body.set("remoteip", ip);

  let data: z.infer<typeof responseSchema>;
  try {
    const response = await fetchImpl(VERIFY_URL, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    const parsed = responseSchema.safeParse(await response.json());
    if (!parsed.success) return { ok: false, reason: "unavailable" };
    data = parsed.data;
  } catch {
    return { ok: false, reason: "unavailable" };
  }

  if (!data.success) return { ok: false, reason: "invalid" };
  if (data.action && data.action !== action) return { ok: false, reason: "wrong_action" };
  return { ok: true, skipped: false };
}
