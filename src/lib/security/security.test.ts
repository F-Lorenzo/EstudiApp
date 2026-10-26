import { beforeEach, describe, expect, it, vi } from "vitest";
import { isRateLimiter, withinRateLimit } from "./rate-limit";
import { verifyTurnstile } from "./turnstile";

const headersMock = vi.hoisted(() => vi.fn());
const cloudflareEnv = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const runtimeEnv = vi.hoisted(() => vi.fn(() => ({}) as Record<string, string | undefined>));
vi.mock("next/headers", () => ({ headers: headersMock }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => ({ env: cloudflareEnv.current }) }));
vi.mock("@/lib/runtime-env", () => ({ runtimeEnv }));

const { clientIp, guardAuthRequest, TURNSTILE_FIELD } = await import("./auth-guard");

/** Un limitador como el de Cloudflare: `limit` pedidos por clave. */
function limiter(limit: number) {
  const counts = new Map<string, number>();
  const fn = vi.fn(async ({ key }: { key: string }) => {
    counts.set(key, (counts.get(key) ?? 0) + 1);
    return { success: (counts.get(key) ?? 0) <= limit };
  });
  return { limit: fn };
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe("withinRateLimit", () => {
  it("sin limitador deja pasar", async () => {
    expect(await withinRateLimit(null, ["a"])).toBe(true);
  });

  it("frena cuando alguna clave se pasa, y cuenta todas", async () => {
    const l = limiter(2);
    expect(await withinRateLimit(l, ["ip", "email"])).toBe(true);
    expect(await withinRateLimit(l, ["ip", "email"])).toBe(true);
    expect(await withinRateLimit(l, ["ip", "otro"])).toBe(false);
    expect(l.limit).toHaveBeenCalledTimes(6);
  });

  it("si el limitador falla, deja pasar y lo anota", async () => {
    const log = vi.fn();
    const roto = { limit: vi.fn(async () => Promise.reject(new Error("caído"))) };
    expect(await withinRateLimit(roto, ["a"], log)).toBe(true);
    expect(log).toHaveBeenCalled();
  });

  it("reconoce un limitador", () => {
    expect(isRateLimiter(limiter(1))).toBe(true);
    expect(isRateLimiter("x")).toBe(false);
    expect(isRateLimiter(null)).toBe(false);
  });
});

describe("verifyTurnstile", () => {
  it("sin clave secreta está apagado", async () => {
    const fetchImpl = vi.fn();
    expect(await verifyTurnstile({ secret: " ", token: undefined, ip: null, action: "login", fetchImpl })).toEqual({ ok: true, skipped: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("con clave, sin token no pasa ni llama a Cloudflare", async () => {
    const fetchImpl = vi.fn();
    expect(await verifyTurnstile({ secret: "s", token: "", ip: null, action: "login", fetchImpl })).toEqual({ ok: false, reason: "missing_token" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("manda la clave, el token y la IP, y acepta un token válido del mismo formulario", async () => {
    const fetchImpl = vi.fn(async () => json({ success: true, action: "login" }));
    const result = await verifyTurnstile({ secret: "s3cr3t", token: "tok", ip: "1.2.3.4", action: "login", fetchImpl });
    expect(result).toEqual({ ok: true, skipped: false });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    const body = init.body as URLSearchParams;
    expect(body.get("secret")).toBe("s3cr3t");
    expect(body.get("response")).toBe("tok");
    expect(body.get("remoteip")).toBe("1.2.3.4");
  });

  it("rechaza un token inválido, uno de otro formulario y una respuesta rara", async () => {
    const run = (body: unknown) => verifyTurnstile({ secret: "s", token: "t", ip: null, action: "login", fetchImpl: vi.fn(async () => json(body)) });
    expect(await run({ success: false, "error-codes": ["invalid-input-response"] })).toEqual({ ok: false, reason: "invalid" });
    expect(await run({ success: true, action: "registro" })).toEqual({ ok: false, reason: "wrong_action" });
    expect(await run({ nada: true })).toEqual({ ok: false, reason: "unavailable" });
  });

  it("si Cloudflare no responde, no pasa", async () => {
    const fetchImpl = vi.fn(async () => Promise.reject(new TypeError("red")));
    expect(await verifyTurnstile({ secret: "s", token: "t", ip: null, action: "login", fetchImpl })).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("guardAuthRequest", () => {
  beforeEach(() => {
    headersMock.mockResolvedValue(new Headers({ "cf-connecting-ip": "203.0.113.7" }));
    cloudflareEnv.current = {};
    runtimeEnv.mockReturnValue({});
    vi.unstubAllGlobals();
  });

  it("sin limitador ni Turnstile deja pasar (desarrollo)", async () => {
    expect(await guardAuthRequest("login", new FormData(), { email: "ana@ejemplo.com" })).toBeNull();
  });

  it("frena el login después de 10 intentos por minuto desde la misma IP", async () => {
    const l = limiter(10);
    cloudflareEnv.current = { LOGIN_RATE_LIMITER: l };
    for (let i = 0; i < 10; i++) expect(await guardAuthRequest("login", new FormData(), { email: `p${i}@ejemplo.com` })).toBeNull();
    expect(await guardAuthRequest("login", new FormData(), { email: "otra@ejemplo.com" })).toMatch(/muchos intentos/);
    expect(l.limit).toHaveBeenCalledWith({ key: "login:203.0.113.7" });
  });

  it("en el login también cuenta por email, con hash y sin importar mayúsculas", async () => {
    const l = limiter(10);
    cloudflareEnv.current = { LOGIN_RATE_LIMITER: l };
    headersMock.mockImplementation(async () => new Headers({ "cf-connecting-ip": `198.51.100.${Math.floor(Math.random() * 250)}` }));
    for (let i = 0; i < 10; i++) await guardAuthRequest("login", new FormData(), { email: "Ana@Ejemplo.com " });
    expect(await guardAuthRequest("login", new FormData(), { email: "ana@ejemplo.com" })).toMatch(/muchos intentos/);
    const keys = l.limit.mock.calls.map(([o]) => o.key);
    expect(keys.some((k) => k.includes("ana@"))).toBe(false);
  });

  it("el registro y la recuperación usan su propio limitador", async () => {
    const login = limiter(10);
    const signup = limiter(5);
    cloudflareEnv.current = { LOGIN_RATE_LIMITER: login, SIGNUP_RATE_LIMITER: signup };
    for (let i = 0; i < 5; i++) expect(await guardAuthRequest("registro", new FormData())).toBeNull();
    expect(await guardAuthRequest("registro", new FormData())).toMatch(/muchos intentos/);
    expect(await guardAuthRequest("recuperar", new FormData())).toBeNull();
    expect(login.limit).not.toHaveBeenCalled();
  });

  it("con Turnstile encendido, exige el token del formulario", async () => {
    runtimeEnv.mockReturnValue({ TURNSTILE_SITE_KEY: "p", TURNSTILE_SECRET_KEY: "s" });
    const fetchMock = vi.fn(async () => json({ success: true, action: "registro" }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await guardAuthRequest("registro", new FormData())).toMatch(/robot/);
    const form = new FormData();
    form.set(TURNSTILE_FIELD, "tok");
    expect(await guardAuthRequest("registro", form)).toBeNull();
    expect(await guardAuthRequest("login", form)).toMatch(/robot/);
  });
});

describe("guardAuthRequest con una sola clave de Turnstile", () => {
  it("con la secreta y sin la pública no exige el token (si no, nadie podría ingresar)", async () => {
    headersMock.mockResolvedValue(new Headers());
    cloudflareEnv.current = {};
    runtimeEnv.mockReturnValue({ TURNSTILE_SECRET_KEY: "s" });
    expect(await guardAuthRequest("login", new FormData(), { email: "ana@ejemplo.com" })).toBeNull();
  });
});

describe("clientIp", () => {
  it("usa la IP que pone Cloudflare, o la primera de x-forwarded-for", () => {
    expect(clientIp(new Headers({ "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" }))).toBe("1.1.1.1");
    expect(clientIp(new Headers({ "x-forwarded-for": "2.2.2.2, 3.3.3.3" }))).toBe("2.2.2.2");
    expect(clientIp(new Headers())).toBeNull();
  });
});
