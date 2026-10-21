import type { AccountNotice } from "./account-notice";
import { CredentialsError, saveSellerCredentials, type CredentialsDb } from "./credentials";
import type { MercadoPagoClient, OAuthTokens } from "./mercadopago/client";
import { MercadoPagoError } from "./mercadopago/errors";
import {
  createOAuthStateCookieValue,
  deriveStateKey,
  generateOAuthState,
  readStateCookie,
  safeEqualText,
  serializeClearedStateCookie,
  serializeStateCookie,
  verifyOAuthStateCookieValue,
} from "./oauth-state";

/**
 * Vinculación de la cuenta de cobro del docente por OAuth: la lógica de las dos rutas
 * (`/api/mercadopago/oauth/start` y `/callback`), con todo lo externo inyectado para probarla sin red.
 *
 *   start     → exige sesión de docente, guarda un `state` aleatorio en una cookie firmada y manda a Mercado Pago.
 *   callback  → comprueba el `state`, la cookie y la sesión; canjea el código; guarda los tokens CIFRADOS.
 *
 * Nunca se escribe un token, el código ni el `state` en una dirección de redirección ni en un log: los
 * motivos de falla son códigos cortos y cerrados. Al terminar el callback (bien o mal) la cookie se borra.
 *
 * A VERIFICAR EN SANDBOX: que Mercado Pago devuelva `code` y `state` en la vuelta y `error=access_denied` si el
 * docente rechaza; que `redirect_uri` coincida exactamente con la cargada en la aplicación.
 */
export const OAUTH_CALLBACK_PATH = "/api/mercadopago/oauth/callback";
const DASHBOARD_PATH = "/docente";

export type SessionUser = { id: string; role: string | null };

export type OAuthDeps = {
  /** Dirección pública de la app, sin barra final (`NEXT_PUBLIC_SITE_URL`, ya validada). */
  siteUrl: string;
  /** Clave de cifrado de los tokens (32 bytes): de ella se deriva la de la firma del estado. */
  encryptionKey: Buffer;
  client: Pick<MercadoPagoClient, "buildAuthorizationUrl" | "exchangeAuthorizationCode">;
  /** Base con permisos de sistema (service role) para guardar las credenciales. */
  db: CredentialsDb;
  /** Persona de la sesión actual, leída de las cookies de Supabase (o `null`). */
  getSessionUser: () => Promise<SessionUser | null>;
  /** `Secure` en la cookie de estado: siempre salvo en desarrollo local. */
  secureCookie: boolean;
  now?: () => Date;
  generateState?: () => string;
  log?: (message: string, data?: Record<string, unknown>) => void;
};

const MAX_PARAM_LENGTH = 512;

function defaultLog(message: string, data?: Record<string, unknown>) {
  console.error(JSON.stringify({ source: "mercadopago-oauth", message, ...data }));
}

function redirectTo(location: string, setCookie?: string) {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  if (setCookie) headers.append("Set-Cookie", setCookie);
  return new Response(null, { status: 302, headers });
}

const noticeLocation = (notice: AccountNotice) => `${DASHBOARD_PATH}?cuenta=${notice}`;

/** Respuesta cuando falta configuración: se vuelve al panel sin contar qué falta. */
export function notConfiguredResponse({ secureCookie }: { secureCookie: boolean }): Response {
  return redirectTo(noticeLocation("sin_configurar"), serializeClearedStateCookie({ secure: secureCookie }));
}

// --- Inicio ------------------------------------------------------------------------------------------------

export async function handleOAuthStart(_request: Request, deps: OAuthDeps): Promise<Response> {
  const log = deps.log ?? defaultLog;
  const now = (deps.now ?? (() => new Date()))();

  let user: SessionUser | null;
  try {
    user = await deps.getSessionUser();
  } catch {
    log("no se pudo leer la sesión al iniciar la vinculación", { reason: "sesion_no_disponible" });
    return redirectTo(noticeLocation("error"));
  }
  if (!user) return redirectTo(`/login?${new URLSearchParams({ redirectTo: DASHBOARD_PATH })}`);
  if (user.role !== "docente") return redirectTo("/");

  try {
    const state = (deps.generateState ?? generateOAuthState)();
    const cookie = createOAuthStateCookieValue({ state, tutorId: user.id }, deriveStateKey(deps.encryptionKey), now);
    const authorizationUrl = deps.client.buildAuthorizationUrl({
      redirectUri: `${deps.siteUrl}${OAUTH_CALLBACK_PATH}`,
      state,
    });
    return redirectTo(authorizationUrl, serializeStateCookie(cookie, { secure: deps.secureCookie }));
  } catch (error) {
    // Lo más probable: falta MERCADOPAGO_CLIENT_ID. Se registra el tipo de falla, nunca el detalle.
    log("no se pudo armar la dirección de autorización", {
      reason: error instanceof MercadoPagoError ? error.kind : "inesperado",
    });
    return notConfiguredResponse({ secureCookie: deps.secureCookie });
  }
}

// --- Vuelta de Mercado Pago ----------------------------------------------------------------------------

export async function handleOAuthCallback(request: Request, deps: OAuthDeps): Promise<Response> {
  const log = deps.log ?? defaultLog;
  const now = (deps.now ?? (() => new Date()))();

  // La cookie de estado se borra SIEMPRE: cada vuelta es de un solo uso.
  const clearCookie = serializeClearedStateCookie({ secure: deps.secureCookie });
  const done = (notice: AccountNotice) => {
    const response = redirectTo(noticeLocation(notice), clearCookie);
    // Por si algún día la dirección de la vuelta llegara a quedar en un `Referer`.
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  };
  const fail = (reason: string, data?: Record<string, unknown>) => {
    log("la vinculación de la cuenta de cobro falló", { reason, ...data });
    return done("error");
  };

  try {
    const params = new URL(request.url).searchParams;

    // El docente rechazó la autorización (o Mercado Pago avisó un error): no es una falla nuestra.
    if (params.has("error")) return done("cancelada");

    const code = params.get("code");
    const state = params.get("state");
    if (!code || !state || code.length > MAX_PARAM_LENGTH || state.length > MAX_PARAM_LENGTH) {
      return fail("faltan_parametros");
    }

    const cookieValue = readStateCookie(request.headers.get("cookie"));
    if (!cookieValue) return fail("cookie_ausente");
    const verification = verifyOAuthStateCookieValue(cookieValue, deriveStateKey(deps.encryptionKey), now);
    if (!verification.ok) return fail(`cookie_${verification.reason}`);
    const { payload } = verification;

    if (!safeEqualText(state, payload.state)) return fail("state_distinto");

    const user = await deps.getSessionUser();
    if (!user) return fail("sin_sesion");
    if (user.id !== payload.tutorId) return fail("sesion_distinta");
    if (user.role !== "docente") return fail("no_docente");

    // Desde acá el código se gasta: el canje no se reintenta (ver `client.ts`).
    let tokens: OAuthTokens;
    try {
      tokens = await deps.client.exchangeAuthorizationCode({
        code,
        redirectUri: `${deps.siteUrl}${OAUTH_CALLBACK_PATH}`,
      });
    } catch (error) {
      const mercadoPagoError = error instanceof MercadoPagoError ? error : null;
      return fail(
        "canje_fallido",
        mercadoPagoError
          ? {
              kind: mercadoPagoError.kind,
              status: mercadoPagoError.status,
              // Código cerrado que devuelve Mercado Pago (p. ej. `invalid_client`), útil para
              // diagnosticar la configuración sin registrar la respuesta ni credenciales.
              ...(mercadoPagoError.code ? { code: mercadoPagoError.code } : {}),
            }
          : undefined,
      );
    }

    try {
      await saveSellerCredentials(deps.db, { tutorId: user.id, tokens, key: deps.encryptionKey });
    } catch (error) {
      if (error instanceof CredentialsError) {
        if (error.reason === "account_already_linked") {
          log("la cuenta de Mercado Pago ya está vinculada a otro docente", { reason: error.reason });
          return done("ya_vinculada");
        }
        if (error.reason === "has_active_bookings" || error.reason === "has_pending_refunds") {
          log("cambio de cuenta bloqueado por plata en camino", { reason: error.reason });
          return done("cambio_bloqueado");
        }
        return fail("guardado_fallido", { detail: error.reason });
      }
      return fail("guardado_fallido");
    }

    return done("vinculada");
  } catch {
    return fail("inesperado");
  }
}
