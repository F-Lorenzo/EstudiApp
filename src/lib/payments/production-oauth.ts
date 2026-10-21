import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { runtimeEnv } from "@/lib/runtime-env";
import { createMercadoPagoClient } from "./mercadopago/client";
import {
  notConfiguredResponse,
  type OAuthDeps,
  type SessionUser,
} from "./oauth-handlers";
import { siteUrl } from "./site-url";
import { parseEncryptionKey } from "./token-crypto";
import type { TokenRefreshDeps } from "./token-refresh";

/**
 * Arma las dependencias reales de la vinculación (y de la renovación de tokens) desde las variables de
 * entorno del servidor. Si falta alguna lanza `OAuthConfigError` con los NOMBRES de lo que falta (nunca
 * sus valores): mejor avisar «sin configurar» que mandar a un docente a Mercado Pago para que falle al volver.
 *
 *   NEXT_PUBLIC_SITE_URL                 dirección pública (la de retorno del OAuth se arma con ella)
 *   MERCADOPAGO_CLIENT_ID / _SECRET      aplicación de Mercado Pago
 *   MERCADOPAGO_TOKEN_ENCRYPTION_KEY     cifra los tokens y deriva la firma de la cookie de estado
 *   SUPABASE_SERVICE_ROLE_KEY            guarda las credenciales con permisos de sistema
 */
export class OAuthConfigError extends Error {
  constructor(readonly missing: string[]) {
    super(`Falta configurar: ${missing.join(", ")}.`);
    this.name = "OAuthConfigError";
  }
}

type Env = Record<string, string | undefined>;

/** `Secure` en la cookie de estado salvo en `next dev` (http://localhost no es https). */
export const isSecureCookieEnvironment = (env: Env = runtimeEnv()) => env.NODE_ENV !== "development";

/** `needSite`: la dirección pública solo hace falta para vincular (la de retorno), no para renovar tokens. */
function requireConfig(env: Env, { needSite }: { needSite: boolean }) {
  const missing: string[] = [];

  let site = "";
  if (needSite) {
    try {
      site = siteUrl(env);
    } catch {
      missing.push("NEXT_PUBLIC_SITE_URL");
    }
  }

  const clientId = env.MERCADOPAGO_CLIENT_ID || undefined;
  const clientSecret = env.MERCADOPAGO_CLIENT_SECRET || undefined;
  if (!clientId) missing.push("MERCADOPAGO_CLIENT_ID");
  if (!clientSecret) missing.push("MERCADOPAGO_CLIENT_SECRET");

  let encryptionKey: Buffer | null = null;
  try {
    encryptionKey = parseEncryptionKey(env.MERCADOPAGO_TOKEN_ENCRYPTION_KEY);
  } catch {
    missing.push("MERCADOPAGO_TOKEN_ENCRYPTION_KEY");
  }

  if (!env.SUPABASE_SERVICE_ROLE_KEY || !env.NEXT_PUBLIC_SUPABASE_URL) missing.push("SUPABASE_SERVICE_ROLE_KEY");

  if (missing.length > 0 || !encryptionKey) throw new OAuthConfigError(missing);
  return { site, clientId, clientSecret, encryptionKey };
}

/** Persona de la sesión actual (cookies de Supabase) con su rol, o `null` si no hay sesión. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<{ role: string }>();
  return { id: user.id, role: profile?.role ?? null };
}

export function createOAuthDeps(env: Env = runtimeEnv()): OAuthDeps {
  const { site, clientId, clientSecret, encryptionKey } = requireConfig(env, { needSite: true });
  return {
    siteUrl: site,
    encryptionKey,
    client: createMercadoPagoClient({ clientId, clientSecret }),
    db: createAdminClient(),
    getSessionUser,
    secureCookie: isSecureCookieEnvironment(env),
  };
}

/** Dependencias del barrido de renovación de tokens (`refreshExpiringTokens`), para la ruta de mantenimiento. */
export function createTokenRefreshDeps(env: Env = runtimeEnv()): Pick<TokenRefreshDeps, "db" | "client" | "key"> {
  const { clientId, clientSecret, encryptionKey } = requireConfig(env, { needSite: false });
  return {
    db: createAdminClient(),
    client: createMercadoPagoClient({ clientId, clientSecret }),
    key: encryptionKey,
  };
}

/**
 * Corre un manejador del OAuth con las dependencias reales. Si falta configuración responde
 * «sin configurar» (y deja en el log qué variables faltan, sin valores).
 */
export async function runOAuthRoute(
  request: Request,
  handler: (request: Request, deps: OAuthDeps) => Promise<Response>,
): Promise<Response> {
  let deps: OAuthDeps;
  try {
    deps = createOAuthDeps();
  } catch (error) {
    console.error(
      JSON.stringify({
        source: "mercadopago-oauth",
        message: "faltan variables de entorno de la vinculación",
        missing: error instanceof OAuthConfigError ? error.missing : "desconocido",
      }),
    );
    return notConfiguredResponse({ secureCookie: isSecureCookieEnvironment() });
  }
  return handler(request, deps);
}
