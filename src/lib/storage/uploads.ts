/**
 * Fotos de perfil y respaldos de los docentes en Supabase Storage (migración 0026, decisión del 28 de octubre de
 * 2026). Lo comparten el navegador (que sube) y el servidor (que guarda la referencia y limpia lo viejo).
 *
 *   avatars       pública. Se guarda en `profiles.avatar_url` la dirección pública del archivo.
 *   credentials   privada. Se guarda en `tutor_private.credential_url` el nombre del archivo (`<id>/<uuid>.pdf`);
 *                 para verlo, el servidor pide un enlace firmado que vence.
 *
 * Cada archivo vive en la subcarpeta de su cuenta con un nombre al azar: así una foto nueva nunca queda tapada por
 * la vieja en la caché y nadie adivina la dirección de un archivo.
 */

export const AVATAR_BUCKET = "avatars";
export const CREDENTIAL_BUCKET = "credentials";

/** Lado de la foto ya achicada, en píxeles. */
export const AVATAR_SIZE = 400;
/** Lo más grande que se acepta elegir (antes de achicarla). */
export const AVATAR_MAX_SOURCE_BYTES = 15 * 1024 * 1024;
/** Igual que la carpeta en la base (0026). */
export const CREDENTIAL_MAX_BYTES = 5 * 1024 * 1024;
export const CREDENTIAL_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
/** Cuánto dura el enlace para ver un respaldo. */
export const CREDENTIAL_LINK_SECONDS = 10 * 60;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Nombre nuevo para un archivo de la cuenta: `<id>/<uuid>.<extensión>`. */
export function newObjectName(userId: string, extension: string) {
  return `${userId}/${crypto.randomUUID()}.${extension}`;
}

/** Dirección pública de un archivo de la carpeta de fotos (`supabaseUrl` sin barra final). */
export function avatarPublicUrl(supabaseUrl: string, objectName: string) {
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${AVATAR_BUCKET}/${objectName}`;
}

/** El nombre del archivo si `url` es una foto subida por ESTA cuenta; si no, `null`. */
export function ownAvatarObject(url: string, supabaseUrl: string, userId: string): string | null {
  const prefix = escape(avatarPublicUrl(supabaseUrl, `${userId}/`));
  const match = new RegExp(`^${prefix}(${UUID}\\.(?:webp|jpg|png))$`, "i").exec(url);
  return match ? `${userId}/${match[1]}` : null;
}

/** ¿`path` es un respaldo subido por ESTA cuenta? */
export function isOwnCredentialObject(path: string, userId: string) {
  return new RegExp(`^${escape(userId)}/${UUID}\\.(?:pdf|jpg|png|webp)$`, "i").test(path);
}

/** Los respaldos de antes de la 0026 eran enlaces: se siguen mostrando como enlace. */
export function isExternalLink(value: string) {
  return /^https?:\/\//i.test(value);
}

/** Recorte cuadrado centrado de una imagen de `width` × `height`. */
export function centeredSquare(width: number, height: number) {
  const side = Math.min(width, height);
  return { x: Math.round((width - side) / 2), y: Math.round((height - side) / 2), side };
}
