import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chain } from "@/test/fake-supabase";

const createClient = vi.hoisted(() => vi.fn());
const createAdminClient = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));

import {
  OAuthConfigError,
  createOAuthDeps,
  createTokenRefreshDeps,
  getSessionUser,
  isSecureCookieEnvironment,
  runOAuthRoute,
} from "./production-oauth";

const KEY = Buffer.alloc(32, 8).toString("base64");
const ADMIN = { rpc: vi.fn() };

const FULL_ENV = {
  NEXT_PUBLIC_SITE_URL: "https://estudiapp.example",
  MERCADOPAGO_CLIENT_ID: "3206837453843096",
  MERCADOPAGO_CLIENT_SECRET: "secreto-de-la-aplicacion",
  MERCADOPAGO_TOKEN_ENCRYPTION_KEY: KEY,
  SUPABASE_SERVICE_ROLE_KEY: "service-role-secreta",
  NEXT_PUBLIC_SUPABASE_URL: "https://proyecto.supabase.example",
};

beforeEach(() => {
  createAdminClient.mockReset().mockReturnValue(ADMIN);
  createClient.mockReset();
  vi.unstubAllEnvs();
});
afterEach(() => vi.restoreAllMocks());

describe("createOAuthDeps", () => {
  it("con toda la configuración arma las dependencias reales", () => {
    const deps = createOAuthDeps(FULL_ENV);
    expect(deps.siteUrl).toBe("https://estudiapp.example");
    expect(deps.encryptionKey).toHaveLength(32);
    expect(deps.db).toBe(ADMIN);
    expect(deps.secureCookie).toBe(true);
    expect(typeof deps.client.buildAuthorizationUrl).toBe("function");
    // La dirección de autorización usa la aplicación configurada y la dirección de retorno pedida.
    const url = new URL(deps.client.buildAuthorizationUrl({ redirectUri: "https://estudiapp.example/api/mercadopago/oauth/callback", state: "abc" }));
    expect(url.searchParams.get("client_id")).toBe("3206837453843096");
    expect(url.searchParams.get("state")).toBe("abc");
  });

  it.each([
    "NEXT_PUBLIC_SITE_URL",
    "MERCADOPAGO_CLIENT_ID",
    "MERCADOPAGO_CLIENT_SECRET",
    "MERCADOPAGO_TOKEN_ENCRYPTION_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ])("si falta %s lanza un error que nombra la variable y no muestra valores", (name) => {
    const env = { ...FULL_ENV, [name]: undefined };
    const error = (() => {
      try {
        createOAuthDeps(env);
      } catch (e) {
        return e;
      }
    })() as OAuthConfigError;

    expect(error).toBeInstanceOf(OAuthConfigError);
    expect(error.missing).toEqual([name]);
    for (const value of Object.values(FULL_ENV)) expect(error.message).not.toContain(value);
  });

  it("una variable vacía cuenta como faltante", () => {
    expect(() => createOAuthDeps({ ...FULL_ENV, MERCADOPAGO_CLIENT_ID: "" })).toThrow(OAuthConfigError);
  });

  it("junta todo lo que falta en un solo error", () => {
    const error = (() => {
      try {
        createOAuthDeps({});
      } catch (e) {
        return e;
      }
    })() as OAuthConfigError;
    expect(error.missing).toEqual([
      "NEXT_PUBLIC_SITE_URL",
      "MERCADOPAGO_CLIENT_ID",
      "MERCADOPAGO_CLIENT_SECRET",
      "MERCADOPAGO_TOKEN_ENCRYPTION_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
    ]);
  });

  it.each([
    ["una dirección http que no es local", { NEXT_PUBLIC_SITE_URL: "http://estudiapp.example" }, "NEXT_PUBLIC_SITE_URL"],
    ["una clave de cifrado que no es de 32 bytes", { MERCADOPAGO_TOKEN_ENCRYPTION_KEY: "corta" }, "MERCADOPAGO_TOKEN_ENCRYPTION_KEY"],
  ])("%s se toma como configuración faltante", (_label, change, name) => {
    const error = (() => {
      try {
        createOAuthDeps({ ...FULL_ENV, ...change });
      } catch (e) {
        return e;
      }
    })() as OAuthConfigError;
    expect(error.missing).toEqual([name]);
  });

  it("acepta http://localhost en desarrollo y entonces la cookie no lleva Secure", () => {
    const deps = createOAuthDeps({ ...FULL_ENV, NEXT_PUBLIC_SITE_URL: "http://localhost:3000", NODE_ENV: "development" });
    expect(deps.siteUrl).toBe("http://localhost:3000");
    expect(deps.secureCookie).toBe(false);
  });
});

describe("createTokenRefreshDeps", () => {
  it("no necesita la dirección pública (renovar tokens no arma direcciones de retorno)", () => {
    const { NEXT_PUBLIC_SITE_URL: _omitida, ...env } = FULL_ENV;
    void _omitida;
    const deps = createTokenRefreshDeps(env);
    expect(deps.db).toBe(ADMIN);
    expect(deps.key).toHaveLength(32);
    expect(typeof deps.client.refreshAccessToken).toBe("function");
  });

  it("sí necesita la clave de cifrado, la aplicación y la service role", () => {
    expect(() => createTokenRefreshDeps({ ...FULL_ENV, MERCADOPAGO_TOKEN_ENCRYPTION_KEY: undefined })).toThrow(OAuthConfigError);
    expect(() => createTokenRefreshDeps({ ...FULL_ENV, MERCADOPAGO_CLIENT_SECRET: undefined })).toThrow(OAuthConfigError);
    expect(() => createTokenRefreshDeps({ ...FULL_ENV, SUPABASE_SERVICE_ROLE_KEY: undefined })).toThrow(OAuthConfigError);
  });
});

describe("isSecureCookieEnvironment", () => {
  it.each([
    ["development", false],
    ["production", true],
    ["test", true],
    [undefined, true],
  ])("NODE_ENV=%s → Secure=%s", (nodeEnv, secure) => {
    expect(isSecureCookieEnvironment({ NODE_ENV: nodeEnv })).toBe(secure);
  });
});

describe("runOAuthRoute", () => {
  const request = new Request("https://estudiapp.example/api/mercadopago/oauth/start");

  it("sin configuración responde «sin_configurar», no corre el manejador y registra solo los nombres que faltan", async () => {
    for (const name of Object.keys(FULL_ENV)) vi.stubEnv(name, "");
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handler = vi.fn();

    const response = await runOAuthRoute(request, handler);

    expect(handler).not.toHaveBeenCalled();
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/docente?cuenta=sin_configurar");
    expect(response.headers.getSetCookie()[0]).toMatch(/^mp_oauth_state=; Max-Age=0/);
    const entry = JSON.parse(logged.mock.calls[0][0] as string);
    expect(entry.missing).toContain("MERCADOPAGO_CLIENT_ID");
  });

  it("con configuración corre el manejador con las dependencias reales", async () => {
    for (const [name, value] of Object.entries(FULL_ENV)) vi.stubEnv(name, value);
    const handler = vi.fn(async () => new Response("ok"));

    const response = await runOAuthRoute(request, handler);

    expect(await response.text()).toBe("ok");
    expect(handler).toHaveBeenCalledWith(request, expect.objectContaining({ siteUrl: "https://estudiapp.example" }));
  });
});

describe("getSessionUser", () => {
  function supabase({ user, role }: { user: { id: string } | null; role?: string | null }) {
    const client = {
      auth: { getUser: vi.fn(async () => ({ data: { user }, error: null })) },
      from: vi.fn(() => chain({ data: role === undefined ? null : { role } })),
    };
    createClient.mockResolvedValue(client);
    return client;
  }

  it("sin sesión devuelve null y no consulta perfiles", async () => {
    const client = supabase({ user: null });
    expect(await getSessionUser()).toBeNull();
    expect(client.from).not.toHaveBeenCalled();
  });

  it("con sesión devuelve el id y el rol del perfil", async () => {
    const client = supabase({ user: { id: "u1" }, role: "docente" });
    expect(await getSessionUser()).toEqual({ id: "u1", role: "docente" });
    expect(client.from).toHaveBeenCalledWith("profiles");
  });

  it("si el perfil no se encuentra el rol queda en null (nunca se asume uno)", async () => {
    supabase({ user: { id: "u1" } });
    expect(await getSessionUser()).toEqual({ id: "u1", role: null });
  });
});
