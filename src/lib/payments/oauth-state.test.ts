import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_COOKIE_PATH,
  OAUTH_STATE_TTL_SECONDS,
  createOAuthStateCookieValue,
  deriveStateKey,
  generateOAuthState,
  readStateCookie,
  safeEqualText,
  serializeClearedStateCookie,
  serializeStateCookie,
  verifyOAuthStateCookieValue,
} from "./oauth-state";

const ENCRYPTION_KEY = Buffer.alloc(32, 7);
const KEY = deriveStateKey(ENCRYPTION_KEY);
const NOW = new Date("2026-10-11T15:00:00.000Z");
const TUTOR = "00000000-0000-0000-0000-0000000000d1";

const body = (value: string) => value.split(".")[0];
const signature = (value: string) => value.split(".")[1];
const encode = (payload: unknown) => Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
const sign = (text: string, key: Buffer = KEY) => createHmac("sha256", key).update(text).digest("hex");

function cookie(overrides: { state?: string; tutorId?: string } = {}, at: Date = NOW) {
  return createOAuthStateCookieValue({ state: "estado-1", tutorId: TUTOR, ...overrides }, KEY, at);
}

describe("generateOAuthState", () => {
  it("son 32 bytes en base64url y nunca se repiten", () => {
    const states = new Set(Array.from({ length: 50 }, generateOAuthState));
    expect(states.size).toBe(50);
    for (const state of states) {
      expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(state, "base64url")).toHaveLength(32);
    }
  });
});

describe("deriveStateKey", () => {
  it("es de 32 bytes, determinista y distinta de la clave de cifrado", () => {
    expect(KEY).toHaveLength(32);
    expect(deriveStateKey(ENCRYPTION_KEY).equals(KEY)).toBe(true);
    expect(KEY.equals(ENCRYPTION_KEY)).toBe(false);
  });

  it("otra clave de cifrado da otra clave de firma", () => {
    expect(deriveStateKey(randomBytes(32)).equals(KEY)).toBe(false);
  });
});

describe("verifyOAuthStateCookieValue", () => {
  it("acepta una cookie válida y devuelve lo que se firmó", () => {
    const result = verifyOAuthStateCookieValue(cookie(), KEY, NOW);
    expect(result).toEqual({
      ok: true,
      payload: { state: "estado-1", tutorId: TUTOR, exp: Math.floor(NOW.getTime() / 1000) + OAUTH_STATE_TTL_SECONDS },
    });
  });

  it("vale hasta justo antes de los 10 minutos y deja de valer en el vencimiento", () => {
    const value = cookie();
    const before = new Date(NOW.getTime() + OAUTH_STATE_TTL_SECONDS * 1000 - 1000);
    const at = new Date(NOW.getTime() + OAUTH_STATE_TTL_SECONDS * 1000);
    expect(verifyOAuthStateCookieValue(value, KEY, before).ok).toBe(true);
    expect(verifyOAuthStateCookieValue(value, KEY, at)).toEqual({ ok: false, reason: "expired" });
    expect(verifyOAuthStateCookieValue(value, KEY, new Date(NOW.getTime() + 3_600_000))).toEqual({ ok: false, reason: "expired" });
  });

  it("rechaza una cookie firmada con otra clave", () => {
    const foreign = createOAuthStateCookieValue({ state: "estado-1", tutorId: TUTOR }, deriveStateKey(randomBytes(32)), NOW);
    expect(verifyOAuthStateCookieValue(foreign, KEY, NOW)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rechaza el contenido alterado: el docente, el estado o el vencimiento", () => {
    const original = cookie();
    const payload = JSON.parse(Buffer.from(body(original), "base64url").toString("utf8"));
    for (const changed of [{ ...payload, tutorId: "otro-docente" }, { ...payload, state: "otro" }, { ...payload, exp: payload.exp + 86_400 }]) {
      const tampered = `${encode(changed)}.${signature(original)}`;
      expect(verifyOAuthStateCookieValue(tampered, KEY, NOW)).toEqual({ ok: false, reason: "bad_signature" });
    }
  });

  it("rechaza la firma alterada (un carácter, truncada o en mayúsculas)", () => {
    const original = cookie();
    const flipped = signature(original).replace(/^./, (c) => (c === "0" ? "1" : "0"));
    expect(verifyOAuthStateCookieValue(`${body(original)}.${flipped}`, KEY, NOW)).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyOAuthStateCookieValue(`${body(original)}.${signature(original).slice(0, 62)}`, KEY, NOW)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyOAuthStateCookieValue(`${body(original)}.${signature(original).toUpperCase()}`, KEY, NOW)).toEqual({ ok: false, reason: "malformed" });
  });

  it.each([
    ["ausente", undefined],
    ["nula", null],
    ["vacía", ""],
    ["sin punto", "abcdef"],
    ["con tres partes", "a.b.c"],
    ["con caracteres que no son base64url", `a b.${"0".repeat(64)}`],
    ["con una firma que no es hexadecimal", `abc.${"z".repeat(64)}`],
    ["enorme", `${"a".repeat(2000)}.${"0".repeat(64)}`],
  ])("rechaza una cookie %s", (_label, value) => {
    expect(verifyOAuthStateCookieValue(value, KEY, NOW)).toEqual({ ok: false, reason: "malformed" });
  });

  it("rechaza algo bien firmado pero que no es lo que esperamos (no es JSON, o faltan campos)", () => {
    const sign64 = (text: string) => `${text}.${sign(text)}`;
    const notJson = Buffer.from("esto no es json").toString("base64url");
    expect(verifyOAuthStateCookieValue(sign64(notJson), KEY, NOW)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyOAuthStateCookieValue(sign64(encode({ state: "x" })), KEY, NOW)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyOAuthStateCookieValue(sign64(encode({ state: "x", tutorId: TUTOR, exp: "mañana" })), KEY, NOW)).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(verifyOAuthStateCookieValue(sign64(encode(["x", TUTOR, 1])), KEY, NOW)).toEqual({ ok: false, reason: "malformed" });
  });

  it("una cookie vencida con la firma alterada se informa como firma inválida, no como vencida", () => {
    // Nunca se interpreta el contenido sin una firma válida.
    const old = cookie({}, new Date(NOW.getTime() - 3_600_000));
    const tampered = `${body(old)}.${signature(old).replace(/^./, (c) => (c === "0" ? "1" : "0"))}`;
    expect(verifyOAuthStateCookieValue(tampered, KEY, NOW)).toEqual({ ok: false, reason: "bad_signature" });
  });
});

describe("safeEqualText", () => {
  it("compara textos de cualquier largo", () => {
    expect(safeEqualText("abc", "abc")).toBe(true);
    expect(safeEqualText("abc", "abd")).toBe(false);
    expect(safeEqualText("abc", "abcd")).toBe(false);
    expect(safeEqualText("", "x")).toBe(false);
    expect(safeEqualText("", "")).toBe(true);
  });
});

describe("cookie", () => {
  const value = cookie();

  it("se emite HttpOnly, SameSite=Lax, de 10 minutos y acotada a las rutas del OAuth", () => {
    const header = serializeStateCookie(value, { secure: true });
    const parts = header.split("; ");
    expect(parts[0]).toBe(`${OAUTH_STATE_COOKIE}=${value}`);
    expect(parts).toEqual(expect.arrayContaining([`Max-Age=600`, `Path=${OAUTH_STATE_COOKIE_PATH}`, "HttpOnly", "SameSite=Lax", "Secure"]));
  });

  it("sin Secure solo cuando se pide (desarrollo local)", () => {
    expect(serializeStateCookie(value, { secure: false }).split("; ")).not.toContain("Secure");
    expect(serializeClearedStateCookie({ secure: false }).split("; ")).not.toContain("Secure");
  });

  it("la cookie que borra tiene el mismo nombre y la misma ruta, y vence ya", () => {
    const parts = serializeClearedStateCookie({ secure: true }).split("; ");
    expect(parts[0]).toBe(`${OAUTH_STATE_COOKIE}=`);
    expect(parts).toEqual(expect.arrayContaining([`Path=${OAUTH_STATE_COOKIE_PATH}`, "Max-Age=0", "HttpOnly", "SameSite=Lax", "Secure"]));
    expect(parts.some((part) => part.startsWith("Expires=Thu, 01 Jan 1970"))).toBe(true);
  });

  it("no arma una cabecera con un valor que pueda inyectar otra", () => {
    for (const bad of ["a; Path=/", "a\r\nSet-Cookie: x=1", "a b", "", "a,b"]) {
      expect(() => serializeStateCookie(bad, { secure: true })).toThrow();
    }
  });

  it("la lee de la cabecera Cookie entre otras", () => {
    expect(readStateCookie(`a=1; ${OAUTH_STATE_COOKIE}=${value}; sb-token=xyz`)).toBe(value);
    expect(readStateCookie(`${OAUTH_STATE_COOKIE}=${value}`)).toBe(value);
    expect(readStateCookie("a=1; b=2")).toBeNull();
    expect(readStateCookie(`x${OAUTH_STATE_COOKIE}=${value}`)).toBeNull();
    expect(readStateCookie("")).toBeNull();
    expect(readStateCookie(null)).toBeNull();
    expect(readStateCookie(undefined)).toBeNull();
  });

  it("si viene repetida vale la primera", () => {
    expect(readStateCookie(`${OAUTH_STATE_COOKIE}=primera; ${OAUTH_STATE_COOKIE}=segunda`)).toBe("primera");
  });
});
