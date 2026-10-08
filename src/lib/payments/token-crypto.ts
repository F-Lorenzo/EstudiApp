import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Cifrado de los tokens de Mercado Pago de los docentes antes de guardarlos en `mp_credentials`.
 *
 * Esa tabla ya no se puede leer desde la API pública (solo la service role). El cifrado agrega una
 * segunda barrera: quien llegue a leer la tabla (un backup, un volcado, una consulta mal hecha) no
 * obtiene tokens que sirvan sin la clave, que vive solo en el servidor.
 *
 * AES-256-GCM, con un IV nuevo por cada cifrado y la fila como «dato asociado» (`aad`): un token
 * copiado a la fila de otro docente no se descifra. Formato guardado: `v1.<iv>.<tag>.<texto>` en base64url;
 * el prefijo permite cambiar de algoritmo o de clave más adelante.
 */
const VERSION = "v1";
const IV_BYTES = 12;
const KEY_BYTES = 32;

export class TokenCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenCryptoError";
  }
}

/** La clave son 32 bytes en base64 (`openssl rand -base64 32`). */
export function parseEncryptionKey(value: string | undefined): Buffer {
  if (!value) throw new TokenCryptoError("Falta MERCADOPAGO_TOKEN_ENCRYPTION_KEY.");
  const key = Buffer.from(value, "base64");
  if (key.length !== KEY_BYTES) {
    throw new TokenCryptoError("MERCADOPAGO_TOKEN_ENCRYPTION_KEY tiene que ser de 32 bytes en base64 (openssl rand -base64 32).");
  }
  return key;
}

export function encryptToken(plaintext: string, key: Buffer, aad: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptToken(stored: string, key: Buffer, aad: string): string {
  const [version, iv, tag, ciphertext, ...extra] = stored.split(".");
  if (version !== VERSION || !iv || !tag || !ciphertext || extra.length > 0) {
    throw new TokenCryptoError("El token guardado tiene un formato desconocido.");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    // Clave equivocada, dato alterado o fila distinta: no se distingue ni se detalla.
    throw new TokenCryptoError("No se pudo descifrar el token guardado.");
  }
}

/** Datos asociados de cada token: atan el texto cifrado a su docente y a su tipo. */
export const tokenAad = (tutorId: string, kind: "access" | "refresh") => `mp_credentials:${tutorId}:${kind}`;
