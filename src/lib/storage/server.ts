import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AVATAR_BUCKET,
  CREDENTIAL_BUCKET,
  CREDENTIAL_LINK_SECONDS,
  isExternalLink,
  isOwnCredentialObject,
  ownAvatarObject,
} from "./uploads";

/**
 * Lo que hace el servidor con las subidas (migración 0026): comprobar, antes de guardar, que la foto o el respaldo
 * sean archivos de la propia cuenta, borrar los que quedaron viejos y armar enlaces firmados para ver un respaldo.
 * Corre con la sesión de la persona: las políticas de la base deciden qué puede listar, borrar o leer.
 */

const supabaseUrl = () => process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

export const AVATAR_NOT_OWN = "La foto tiene que subirse desde este formulario.";
export const CREDENTIAL_NOT_OWN = "El respaldo tiene que subirse desde este formulario.";

/** `null` si se puede guardar: vacío, la misma de antes (también un enlace viejo) o una foto propia recién subida. */
export function avatarError(value: string, current: string | null, userId: string): string | null {
  if (!value || value === current) return null;
  return ownAvatarObject(value, supabaseUrl(), userId) ? null : AVATAR_NOT_OWN;
}

/** Igual para el respaldo: vacío, el de antes o un archivo propio de la carpeta privada. */
export function credentialError(value: string, current: string | null, userId: string): string | null {
  if (!value || value === current) return null;
  return isOwnCredentialObject(value, userId) ? null : CREDENTIAL_NOT_OWN;
}

/** El nombre del archivo de la foto guardada (`null` si es un enlace de afuera o no hay). */
export function avatarObjectName(url: string | null, userId: string) {
  return url ? ownAvatarObject(url, supabaseUrl(), userId) : null;
}

/**
 * Borra los archivos de la subcarpeta de la cuenta, menos el que quedó guardado. Nunca falla: si no se pudo, quedan
 * archivos sueltos (se borran la próxima vez) y se anota en el log.
 */
export async function removeOtherFiles(supabase: SupabaseClient, bucket: string, userId: string, keep: string | null) {
  try {
    const { data, error } = await supabase.storage.from(bucket).list(userId, { limit: 100 });
    if (error) throw error;
    const stale = (data ?? []).map((file) => `${userId}/${file.name}`).filter((name) => name !== keep);
    if (!stale.length) return;
    const { error: removeError } = await supabase.storage.from(bucket).remove(stale);
    if (removeError) throw removeError;
  } catch (error) {
    console.error(
      JSON.stringify({
        source: "storage",
        message: "no se pudieron borrar archivos viejos",
        bucket,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

export const removeOtherAvatars = (supabase: SupabaseClient, userId: string, keepUrl: string | null) =>
  removeOtherFiles(supabase, AVATAR_BUCKET, userId, avatarObjectName(keepUrl, userId));

export const removeOtherCredentials = (supabase: SupabaseClient, userId: string, keep: string | null) =>
  removeOtherFiles(supabase, CREDENTIAL_BUCKET, userId, keep && !isExternalLink(keep) ? keep : null);

/**
 * Enlace para ver un respaldo guardado: el mismo enlace si es uno de antes de la 0026; uno firmado que vence en 10
 * minutos si es un archivo; `null` si no hay o no se pudo firmar (por ejemplo, si quien mira no puede leerlo).
 */
export async function credentialViewUrl(supabase: SupabaseClient, value: string | null): Promise<string | null> {
  if (!value) return null;
  if (isExternalLink(value)) return value;
  const { data, error } = await supabase.storage.from(CREDENTIAL_BUCKET).createSignedUrl(value, CREDENTIAL_LINK_SECONDS);
  return error ? null : data.signedUrl;
}
