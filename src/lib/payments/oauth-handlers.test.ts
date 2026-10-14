import { describe, expect, it, vi } from "vitest";
import { fakeRpc } from "@/test/payments-kit";

type RpcConfig = NonNullable<Parameters<typeof fakeRpc>[0]>;
import type { OAuthTokens } from "./mercadopago/client";
import { MercadoPagoError } from "./mercadopago/errors";
import {
  OAUTH_CALLBACK_PATH,
  handleOAuthCallback,
  handleOAuthStart,
  notConfiguredResponse,
  type OAuthDeps,
  type SessionUser,
} from "./oauth-handlers";
import {
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_COOKIE_PATH,
  createOAuthStateCookieValue,
  deriveStateKey,
  readStateCookie,
  verifyOAuthStateCookieValue,
} from "./oauth-state";
import { decryptToken, tokenAad } from "./token-crypto";

const ENCRYPTION_KEY = Buffer.alloc(32, 5);
const STATE_KEY = deriveStateKey(ENCRYPTION_KEY);
const NOW = new Date("2026-10-11T15:00:00.000Z");
const SITE = "https://estudiapp.example";
const REDIRECT_URI = `${SITE}${OAUTH_CALLBACK_PATH}`;
const TUTOR = "00000000-0000-0000-0000-0000000000d1";
const OTHER_TUTOR = "00000000-0000-0000-0000-0000000000d2";
const STATE = "estado-aleatorio-de-prueba-1234567890abcdef";
const CODE = "TG-codigo-de-autorizacion-9876";

const TOKENS: OAuthTokens = {
  accessToken: "APP_USR-ACCESO-SECRETO-1111",
  refreshToken: "TG-REFRESCO-SECRETO-2222",
  mpUserId: "224438158",
  publicKey: "APP_USR-publica",
  liveMode: false,
  expiresAt: new Date(NOW.getTime() + 180 * 86_400_000),
};

const DOCENTE: SessionUser = { id: TUTOR, role: "docente" };

function setup({
  user = DOCENTE as SessionUser | null | "throws",
  rpc = {} as RpcConfig,
  exchange = async () => TOKENS,
  secureCookie = true,
  buildAuthorizationUrl = ({ state }: { redirectUri: string; state: string }) =>
    `https://auth.mercadopago.com.ar/authorization?client_id=1&response_type=code&platform_id=mp&state=${state}&redirect_uri=x`,
}: {
  user?: SessionUser | null | "throws";
  rpc?: RpcConfig;
  exchange?: () => Promise<OAuthTokens>;
  secureCookie?: boolean;
  buildAuthorizationUrl?: (input: { redirectUri: string; state: string }) => string;
} = {}) {
  const kit = fakeRpc(rpc);
  const client = {
    buildAuthorizationUrl: vi.fn(buildAuthorizationUrl),
    exchangeAuthorizationCode: vi.fn(exchange),
  };
  const log = vi.fn();
  const getSessionUser = vi.fn(async () => {
    if (user === "throws") throw new Error("la sesión no se pudo leer");
    return user;
  });
  const deps: OAuthDeps = {
    siteUrl: SITE,
    encryptionKey: ENCRYPTION_KEY,
    client,
    db: kit.db,
    getSessionUser,
    secureCookie,
    now: () => NOW,
    log,
  };
  return { deps, client, log, getSessionUser, rpcCalls: kit.of, allCalls: kit.calls };
}

const stateCookie = (overrides: { state?: string; tutorId?: string; key?: Buffer; at?: Date } = {}) =>
  createOAuthStateCookieValue(
    { state: overrides.state ?? STATE, tutorId: overrides.tutorId ?? TUTOR },
    overrides.key ?? STATE_KEY,
    overrides.at ?? NOW,
  );

function callbackRequest({
  query = { code: CODE, state: STATE } as Record<string, string | undefined>,
  cookie = stateCookie() as string | null,
} = {}) {
  const url = new URL(`${SITE}${OAUTH_CALLBACK_PATH}`);
  for (const [name, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(name, value);
  return new Request(url, { headers: cookie === null ? {} : { cookie: `theme=dark; ${OAUTH_STATE_COOKIE}=${cookie}; sb-session=abc` } });
}

const startRequest = () => new Request(`${SITE}/api/mercadopago/oauth/start`);
const location = (response: Response) => response.headers.get("location") ?? "";
const setCookies = (response: Response) => response.headers.getSetCookie();

/** La cookie de estado quedó borrada: mismo nombre y ruta, vencida ya. */
function expectCleared(response: Response) {
  const cookies = setCookies(response);
  expect(cookies).toHaveLength(1);
  const parts = cookies[0].split("; ");
  expect(parts[0]).toBe(`${OAUTH_STATE_COOKIE}=`);
  expect(parts).toEqual(expect.arrayContaining(["Max-Age=0", `Path=${OAUTH_STATE_COOKIE_PATH}`, "HttpOnly", "SameSite=Lax"]));
}

/** Nada que sirva a un atacante viaja en una redirección ni en un log. */
function expectNoSecrets(texts: string[], extra: string[] = []) {
  const joined = texts.join("\n");
  for (const secret of [TOKENS.accessToken, TOKENS.refreshToken, CODE, STATE, "v1.", ...extra]) {
    expect(joined).not.toContain(secret);
  }
}

// =====================================================================================================
// Inicio
// =====================================================================================================

describe("handleOAuthStart", () => {
  it("un docente va a Mercado Pago con un state aleatorio atado a él en una cookie firmada", async () => {
    const { deps, client, log } = setup();
    const response = await handleOAuthStart(startRequest(), deps);

    expect(response.status).toBe(302);
    expect(client.buildAuthorizationUrl).toHaveBeenCalledTimes(1);
    const { redirectUri, state } = client.buildAuthorizationUrl.mock.calls[0][0];
    expect(redirectUri).toBe("https://estudiapp.example/api/mercadopago/oauth/callback");
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const url = new URL(location(response));
    expect(url.origin).toBe("https://auth.mercadopago.com.ar");
    expect(url.searchParams.get("state")).toBe(state);

    // La cookie: firmada, atada a ESTE docente y a ESTE state, de 10 minutos.
    const [header] = setCookies(response);
    const parts = header.split("; ");
    expect(parts).toEqual(
      expect.arrayContaining(["Max-Age=600", `Path=${OAUTH_STATE_COOKIE_PATH}`, "HttpOnly", "SameSite=Lax", "Secure"]),
    );
    const verified = verifyOAuthStateCookieValue(readStateCookie(header.split(";")[0]), STATE_KEY, NOW);
    expect(verified).toEqual({ ok: true, payload: { state, tutorId: TUTOR, exp: Math.floor(NOW.getTime() / 1000) + 600 } });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(log).not.toHaveBeenCalled();
  });

  it("cada inicio genera un state distinto", async () => {
    const first = setup();
    const second = setup();
    await handleOAuthStart(startRequest(), first.deps);
    await handleOAuthStart(startRequest(), second.deps);
    expect(first.client.buildAuthorizationUrl.mock.calls[0][0].state).not.toBe(second.client.buildAuthorizationUrl.mock.calls[0][0].state);
  });

  it("la cookie no lleva Secure en desarrollo local (http)", async () => {
    const { deps } = setup({ secureCookie: false });
    const [header] = setCookies(await handleOAuthStart(startRequest(), deps));
    expect(header.split("; ")).not.toContain("Secure");
  });

  it("sin sesión manda a ingresar y volver al panel, sin cookie ni salir hacia Mercado Pago", async () => {
    const { deps, client } = setup({ user: null });
    const response = await handleOAuthStart(startRequest(), deps);
    expect(response.status).toBe(302);
    expect(location(response)).toBe("/login?redirectTo=%2Fdocente");
    expect(setCookies(response)).toEqual([]);
    expect(client.buildAuthorizationUrl).not.toHaveBeenCalled();
  });

  it.each([["alumno"], ["administrador"], [null]])("un usuario con rol %s vuelve al inicio, sin cookie", async (role) => {
    const { deps, client } = setup({ user: { id: "x", role } });
    const response = await handleOAuthStart(startRequest(), deps);
    expect(location(response)).toBe("/");
    expect(setCookies(response)).toEqual([]);
    expect(client.buildAuthorizationUrl).not.toHaveBeenCalled();
  });

  it("si falta la configuración de Mercado Pago vuelve al panel con «sin_configurar» y sin detalles", async () => {
    const { deps, log } = setup({
      buildAuthorizationUrl: () => {
        throw new MercadoPagoError("Falta MERCADOPAGO_CLIENT_ID.", { kind: "invalid_request", retryable: false });
      },
    });
    const response = await handleOAuthStart(startRequest(), deps);
    expect(location(response)).toBe("/docente?cuenta=sin_configurar");
    // No deja una cookie de estado que nadie va a usar: la borra.
    expectCleared(response);
    expect(JSON.stringify(log.mock.calls)).not.toContain("MERCADOPAGO_CLIENT_ID");
  });

  it("si no se puede leer la sesión vuelve al panel con «error»", async () => {
    const { deps, client } = setup({ user: "throws" });
    const response = await handleOAuthStart(startRequest(), deps);
    expect(location(response)).toBe("/docente?cuenta=error");
    expect(client.buildAuthorizationUrl).not.toHaveBeenCalled();
  });
});

describe("notConfiguredResponse", () => {
  it("vuelve al panel con «sin_configurar» y borra la cookie de estado", () => {
    const response = notConfiguredResponse({ secureCookie: true });
    expect(response.status).toBe(302);
    expect(location(response)).toBe("/docente?cuenta=sin_configurar");
    expectCleared(response);
  });
});

// =====================================================================================================
// Vuelta de Mercado Pago
// =====================================================================================================

describe("handleOAuthCallback · camino feliz", () => {
  it("canjea el código, guarda los tokens CIFRADOS y atados al docente, y vuelve al panel con «vinculada»", async () => {
    const { deps, client, rpcCalls, log } = setup();
    const response = await handleOAuthCallback(callbackRequest(), deps);

    expect(response.status).toBe(302);
    expect(location(response)).toBe("/docente?cuenta=vinculada");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expectCleared(response);

    // El canje usa el código y la MISMA dirección de retorno registrada en Mercado Pago.
    expect(client.exchangeAuthorizationCode).toHaveBeenCalledTimes(1);
    expect(client.exchangeAuthorizationCode).toHaveBeenCalledWith({ code: CODE, redirectUri: REDIRECT_URI });

    const [save] = rpcCalls("save_mp_credentials");
    expect(rpcCalls("save_mp_credentials")).toHaveLength(1);
    expect(save.args).toMatchObject({
      p_tutor_id: TUTOR,
      p_mp_user_id: "224438158",
      p_public_key: "APP_USR-publica",
      p_live_mode: false,
      p_expires_at: TOKENS.expiresAt.toISOString(),
    });
    // Cifrados: en claro no aparecen, se recuperan solo con la clave y la fila de ESE docente.
    expect(JSON.stringify(save.args)).not.toContain(TOKENS.accessToken);
    expect(JSON.stringify(save.args)).not.toContain(TOKENS.refreshToken);
    expect(decryptToken(save.args.p_access_token as string, ENCRYPTION_KEY, tokenAad(TUTOR, "access"))).toBe(TOKENS.accessToken);
    expect(decryptToken(save.args.p_refresh_token as string, ENCRYPTION_KEY, tokenAad(TUTOR, "refresh"))).toBe(TOKENS.refreshToken);
    expect(() => decryptToken(save.args.p_access_token as string, ENCRYPTION_KEY, tokenAad(OTHER_TUTOR, "access"))).toThrow();
    expect(() => decryptToken(save.args.p_access_token as string, Buffer.alloc(32, 6), tokenAad(TUTOR, "access"))).toThrow();

    expectNoSecrets([location(response), JSON.stringify(log.mock.calls)]);
  });

  it("guarda para el docente de la SESIÓN (que coincide con el de la cookie), no para uno que venga de la dirección", async () => {
    const { deps, rpcCalls } = setup();
    await handleOAuthCallback(callbackRequest({ query: { code: CODE, state: STATE, tutor_id: OTHER_TUTOR, tutorId: OTHER_TUTOR } }), deps);
    expect(rpcCalls("save_mp_credentials")[0].args.p_tutor_id).toBe(TUTOR);
  });

  it("la cookie con la ruta del OAuth no se confunde con otras cookies de la petición", async () => {
    const { deps } = setup();
    const response = await handleOAuthCallback(callbackRequest(), deps);
    expect(location(response)).toBe("/docente?cuenta=vinculada");
  });
});

describe("handleOAuthCallback · el docente rechaza", () => {
  it.each([
    ["access_denied con state", { error: "access_denied", state: STATE }],
    ["error sin más datos", { error: "access_denied" }],
    ["error junto con un code", { error: "access_denied", code: CODE, state: STATE }],
  ])("%s → «cancelada», sin canjear nada y con la cookie borrada", async (_label, query) => {
    const { deps, client, rpcCalls } = setup();
    const response = await handleOAuthCallback(callbackRequest({ query }), deps);
    expect(location(response)).toBe("/docente?cuenta=cancelada");
    expectCleared(response);
    expect(client.exchangeAuthorizationCode).not.toHaveBeenCalled();
    expect(rpcCalls("save_mp_credentials")).toHaveLength(0);
  });
});

describe("handleOAuthCallback · lo que se rechaza ANTES de gastar el código", () => {
  const cases: [string, () => Parameters<typeof callbackRequest>[0], Partial<Parameters<typeof setup>[0]>][] = [
    ["falta el code", () => ({ query: { state: STATE } }), {}],
    ["falta el state", () => ({ query: { code: CODE } }), {}],
    ["no viene nada", () => ({ query: {} }), {}],
    ["el code está vacío", () => ({ query: { code: "", state: STATE } }), {}],
    ["el code es enorme", () => ({ query: { code: "a".repeat(600), state: STATE } }), {}],
    ["no hay cookie de estado", () => ({ cookie: null }), {}],
    ["la cookie de estado está vacía", () => ({ cookie: "" }), {}],
    ["la cookie tiene un formato roto", () => ({ cookie: "esto-no-es-una-cookie-nuestra" }), {}],
    ["la cookie se firmó con otra clave", () => ({ cookie: stateCookie({ key: deriveStateKey(Buffer.alloc(32, 1)) }) }), {}],
    [
      "la cookie fue alterada (otro docente, misma firma)",
      () => {
        const [, signature] = stateCookie().split(".");
        const forged = Buffer.from(JSON.stringify({ state: STATE, tutorId: OTHER_TUTOR, exp: Math.floor(NOW.getTime() / 1000) + 600 })).toString("base64url");
        return { cookie: `${forged}.${signature}` };
      },
      {},
    ],
    ["la cookie ya venció", () => ({ cookie: stateCookie({ at: new Date(NOW.getTime() - 11 * 60_000) }) }), {}],
    ["el state de la dirección no es el de la cookie", () => ({ query: { code: CODE, state: "otro-state-distinto" } }), {}],
    ["no hay sesión", () => ({}), { user: null }],
    ["la sesión es de otro docente", () => ({}), { user: { id: OTHER_TUTOR, role: "docente" } as SessionUser }],
    ["la sesión es de un alumno", () => ({}), { user: { id: TUTOR, role: "alumno" } as SessionUser }],
    ["la sesión es de un administrador", () => ({}), { user: { id: TUTOR, role: "administrador" } as SessionUser }],
    ["la sesión no tiene rol", () => ({}), { user: { id: TUTOR, role: null } as SessionUser }],
    ["la sesión no se puede leer", () => ({}), { user: "throws" as const }],
    [
      "la cookie es de otro docente que el de la sesión",
      () => ({ cookie: stateCookie({ tutorId: OTHER_TUTOR }) }),
      {},
    ],
  ];

  it.each(cases)("%s → «error», sin canjear el código ni guardar nada, y con la cookie borrada", async (_label, build, options) => {
    const { deps, client, rpcCalls, log } = setup(options);
    const response = await handleOAuthCallback(callbackRequest(build()), deps);

    expect(response.status).toBe(302);
    expect(location(response)).toBe("/docente?cuenta=error");
    expectCleared(response);
    expect(client.exchangeAuthorizationCode).not.toHaveBeenCalled();
    expect(rpcCalls("save_mp_credentials")).toHaveLength(0);
    expect(log).toHaveBeenCalledTimes(1);
    expectNoSecrets([location(response), JSON.stringify(log.mock.calls)]);
  });

  it("deja en el log solo un motivo corto y cerrado", async () => {
    const reasons: string[] = [];
    for (const [, build, options] of cases) {
      const { deps, log } = setup(options);
      await handleOAuthCallback(callbackRequest(build()), deps);
      const [message, data] = log.mock.calls[0];
      expect(typeof message).toBe("string");
      expect(Object.keys(data)).toEqual(["reason"]);
      reasons.push(data.reason);
    }
    for (const reason of reasons) expect(reason).toMatch(/^[a-z_]+$/);
    expect(new Set(reasons)).toEqual(
      new Set([
        "faltan_parametros",
        "cookie_ausente",
        "cookie_malformed",
        "cookie_bad_signature",
        "cookie_expired",
        "state_distinto",
        "sin_sesion",
        "sesion_distinta",
        "no_docente",
        "inesperado",
      ]),
    );
  });
});

describe("handleOAuthCallback · el canje y el guardado", () => {
  it.each([
    [
      "Mercado Pago rechaza el código",
      async () => {
        throw new MercadoPagoError(`Mercado Pago respondió 400 (invalid_grant): ${CODE}`, { kind: "http", status: 400, retryable: false, code: "invalid_grant" });
      },
    ],
    [
      "Mercado Pago no responde",
      async () => {
        throw new MercadoPagoError("Mercado Pago no respondió a tiempo.", { kind: "timeout", retryable: true });
      },
    ],
    [
      "algo inesperado",
      async () => {
        throw new TypeError(`explotó con ${CODE} y ${TOKENS.accessToken}`);
      },
    ],
  ])("si el canje falla (%s) → «error», no guarda nada, no reintenta y no filtra el código", async (_label, exchange) => {
    const { deps, client, rpcCalls, log } = setup({ exchange });
    const response = await handleOAuthCallback(callbackRequest(), deps);

    expect(location(response)).toBe("/docente?cuenta=error");
    expectCleared(response);
    expect(client.exchangeAuthorizationCode).toHaveBeenCalledTimes(1);
    expect(rpcCalls("save_mp_credentials")).toHaveLength(0);
    expect(JSON.parse(JSON.stringify(log.mock.calls[0][1]))).toMatchObject({ reason: "canje_fallido" });
    expectNoSecrets([location(response), JSON.stringify(log.mock.calls)]);
  });

  it("en el log de un canje fallido de Mercado Pago queda el tipo y el estado HTTP, nada más", async () => {
    const { deps, log } = setup({
      exchange: async () => {
        throw new MercadoPagoError("texto con datos", { kind: "http", status: 400, retryable: false });
      },
    });
    await handleOAuthCallback(callbackRequest(), deps);
    expect(log.mock.calls[0][1]).toEqual({ reason: "canje_fallido", kind: "http", status: 400 });
  });

  it("una cuenta ya vinculada a otro docente → «ya_vinculada»", async () => {
    const { deps, rpcCalls } = setup({ rpc: { save_mp_credentials: { error: { message: "texto de la base", hint: "account_already_linked" } } } });
    const response = await handleOAuthCallback(callbackRequest(), deps);
    expect(location(response)).toBe("/docente?cuenta=ya_vinculada");
    expectCleared(response);
    expect(rpcCalls("save_mp_credentials")).toHaveLength(1);
  });

  it.each(["has_active_bookings", "has_pending_refunds"])("cambiar de cuenta con plata en camino (%s) → «cambio_bloqueado»", async (hint) => {
    const { deps } = setup({ rpc: { save_mp_credentials: { error: { message: "x", hint } } } });
    const response = await handleOAuthCallback(callbackRequest(), deps);
    expect(location(response)).toBe("/docente?cuenta=cambio_bloqueado");
    expectCleared(response);
  });

  it.each([
    ["no_a_tutor", "not_a_tutor"],
    ["credenciales inválidas", "invalid_credentials"],
    ["la base no responde", null],
    ["un hint desconocido", "otra_cosa"],
  ])("cualquier otro error al guardar (%s) → «error», sin filtrar tokens", async (_label, hint) => {
    const { deps, log } = setup({ rpc: { save_mp_credentials: { error: { message: `detalle con ${TOKENS.refreshToken}`, hint } } } });
    const response = await handleOAuthCallback(callbackRequest(), deps);
    expect(location(response)).toBe("/docente?cuenta=error");
    expectCleared(response);
    expect(log.mock.calls[0][1]).toMatchObject({ reason: "guardado_fallido" });
    expectNoSecrets([location(response), JSON.stringify(log.mock.calls)]);
  });
});

describe("handleOAuthCallback · en todos los caminos", () => {
  const scenarios: [string, Parameters<typeof setup>[0], Parameters<typeof callbackRequest>[0]][] = [
    ["éxito", {}, {}],
    ["rechazo del docente", {}, { query: { error: "access_denied", state: STATE } }],
    ["sin code", {}, { query: { state: STATE } }],
    ["sin cookie", {}, { cookie: null }],
    ["cookie vencida", {}, { cookie: stateCookie({ at: new Date(NOW.getTime() - 3_600_000) }) }],
    ["state distinto", {}, { query: { code: CODE, state: "otro" } }],
    ["otra sesión", { user: { id: OTHER_TUTOR, role: "docente" } }, {}],
    ["canje fallido", { exchange: async () => { throw http400(); } }, {}],
    ["cuenta ya vinculada", { rpc: { save_mp_credentials: { error: { message: "x", hint: "account_already_linked" } } } }, {}],
    ["error al guardar", { rpc: { save_mp_credentials: { error: { message: "x", hint: null } } } }, {}],
  ];

  function http400() {
    return new MercadoPagoError("x", { kind: "http", status: 400, retryable: false });
  }

  it.each(scenarios)("%s: la cookie de estado se borra y el redirect es al panel con un código cerrado, sin secretos", async (_label, options, request) => {
    const { deps, log } = setup(options);
    const response = await handleOAuthCallback(callbackRequest(request), deps);

    expectCleared(response);
    expect(location(response)).toMatch(/^\/docente\?cuenta=(vinculada|cancelada|ya_vinculada|cambio_bloqueado|error)$/);
    expectNoSecrets([location(response), JSON.stringify([...response.headers]), JSON.stringify(log.mock.calls)]);
  });

  it("nunca pone el code ni el state de la dirección en otra dirección, aunque traigan caracteres raros", async () => {
    const evil = "https://evil.example/?x=<script>";
    const { deps } = setup();
    const response = await handleOAuthCallback(callbackRequest({ query: { code: evil, state: evil } }), deps);
    expect(location(response)).toBe("/docente?cuenta=error");
  });

  it("no se canjea dos veces el mismo pedido: un solo canje por vuelta", async () => {
    const { deps, client } = setup();
    await handleOAuthCallback(callbackRequest(), deps);
    expect(client.exchangeAuthorizationCode).toHaveBeenCalledTimes(1);
  });
});
