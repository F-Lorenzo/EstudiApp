import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * Estado del OAuth de Mercado Pago (protección contra CSRF al vincular la cuenta de cobro).
 *
 * Al empezar la vinculación se genera un `state` aleatorio y se guarda en una cookie FIRMADA que lo ata
 * al docente que apretó el botón. Al volver de Mercado Pago el `state` de la dirección tiene que ser el
 * mismo que el de la cookie, la firma tiene que cerrar y el usuario de la sesión tiene que ser el mismo
 * docente. Así nadie puede hacer que un docente vincule la cuenta de otra persona con un enlace armado.
 *
 * Formato de la cookie: `base64url(JSON {state, tutorId, exp}) + "." + HMAC-SHA256 (hex)`. La clave de la
 * firma se DERIVA (HKDF-SHA256) de MERCADOPAGO_TOKEN_ENCRYPTION_KEY con una etiqueta propia: nunca se usa
 * la clave de cifrado de los tokens directamente para firmar.
 *
 * Todo acá es puro (sin red, sin cookies de Next): se prueba sin levantar nada.
 */
export const OAUTH_STATE_COOKIE = "mp_oauth_state";
export const OAUTH_STATE_COOKIE_PATH = "/api/mercadopago/oauth";
export const OAUTH_STATE_TTL_SECONDS = 600;

const KDF_INFO = "estudiapp/oauth-state";
const STATE_BYTES = 32;
const MAX_COOKIE_LENGTH = 1024;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const HEX_SHA256 = /^[0-9a-f]{64}$/;

export type OAuthStatePayload = {
  /** Valor aleatorio que viaja a Mercado Pago y vuelve en la dirección de retorno. */
  state: string;
  /** Docente que empezó la vinculación. */
  tutorId: string;
  /** Vencimiento, en segundos desde 1970. */
  exp: number;
};

export type OAuthStateFailure =
  /** No tiene la forma esperada (cookie ausente, cortada o inventada). */
  | "malformed"
  /** La firma no cierra: la cookie fue alterada o la firmó otra clave. */
  | "bad_signature"
  /** Está bien firmada pero ya pasó su vencimiento. */
  | "expired";

export type OAuthStateVerification =
  | { ok: true; payload: OAuthStatePayload }
  | { ok: false; reason: OAuthStateFailure };

const payloadSchema = z.object({
  state: z.string().min(1).max(128),
  tutorId: z.string().min(1).max(64),
  exp: z.number().int().positive(),
});

/** 32 bytes aleatorios en base64url (43 caracteres). */
export function generateOAuthState(): string {
  return randomBytes(STATE_BYTES).toString("base64url");
}

/** Clave de firma derivada de la clave de cifrado de los tokens (HKDF-SHA256, etiqueta propia). */
export function deriveStateKey(encryptionKey: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", encryptionKey, Buffer.alloc(0), KDF_INFO, 32));
}

function mac(body: string, key: Buffer): string {
  return createHmac("sha256", key).update(body).digest("hex");
}

/** Arma el valor de la cookie para ese estado. `now` se inyecta en las pruebas. */
export function createOAuthStateCookieValue(
  { state, tutorId }: { state: string; tutorId: string },
  key: Buffer,
  now: Date = new Date(),
): string {
  const payload: OAuthStatePayload = {
    state,
    tutorId,
    exp: Math.floor(now.getTime() / 1000) + OAUTH_STATE_TTL_SECONDS,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${mac(body, key)}`;
}

/** Comprueba forma, firma y vencimiento (en ese orden: nunca se interpreta algo sin firma válida). */
export function verifyOAuthStateCookieValue(
  value: string | null | undefined,
  key: Buffer,
  now: Date = new Date(),
): OAuthStateVerification {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_COOKIE_LENGTH) {
    return { ok: false, reason: "malformed" };
  }
  const parts = value.split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed" };
  const [body, signature] = parts;
  if (!BASE64URL.test(body) || !HEX_SHA256.test(signature)) return { ok: false, reason: "malformed" };

  const expected = Buffer.from(mac(body, key), "hex");
  const received = Buffer.from(signature, "hex");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return { ok: false, reason: "bad_signature" };
  }

  let parsed: z.infer<typeof payloadSchema>;
  try {
    const result = payloadSchema.safeParse(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
    if (!result.success) return { ok: false, reason: "malformed" };
    parsed = result.data;
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (now.getTime() / 1000 >= parsed.exp) return { ok: false, reason: "expired" };
  return { ok: true, payload: parsed };
}

/** Compara dos textos en tiempo constante (el `state` de la dirección contra el de la cookie). */
export function safeEqualText(a: string, b: string): boolean {
  // Se comparan los hashes para que `timingSafeEqual` reciba siempre el mismo largo.
  const hash = (text: string) => createHmac("sha256", "estudiapp/safe-equal").update(text).digest();
  return timingSafeEqual(hash(a), hash(b));
}

// --- Cookie ----------------------------------------------------------------------------------------------

const COOKIE_VALUE = /^[A-Za-z0-9_.-]+$/;

/**
 * Cabecera `Set-Cookie` de la cookie de estado: HttpOnly (el JavaScript de la página no la ve), SameSite=Lax
 * (viaja en la vuelta desde Mercado Pago, que es una navegación de nivel superior, pero no en pedidos
 * cruzados), acotada a las rutas del OAuth y de corta vida. `secure` va activo salvo en desarrollo.
 */
export function serializeStateCookie(value: string, { secure }: { secure: boolean }): string {
  // Defensa en profundidad: el valor lo generamos nosotros, pero nunca se arma una cabecera con algo raro.
  if (!COOKIE_VALUE.test(value)) throw new Error("Valor de cookie no válido.");
  return [
    `${OAUTH_STATE_COOKIE}=${value}`,
    `Max-Age=${OAUTH_STATE_TTL_SECONDS}`,
    `Path=${OAUTH_STATE_COOKIE_PATH}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

/** Cabecera `Set-Cookie` que borra la cookie de estado (mismos atributos de ruta que al crearla). */
export function serializeClearedStateCookie({ secure }: { secure: boolean }): string {
  return [
    `${OAUTH_STATE_COOKIE}=`,
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    `Path=${OAUTH_STATE_COOKIE_PATH}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

/** Lee la cookie de estado de una cabecera `Cookie`. Si viene repetida, vale la primera. */
export function readStateCookie(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === OAUTH_STATE_COOKIE) return part.slice(separator + 1).trim();
  }
  return null;
}
