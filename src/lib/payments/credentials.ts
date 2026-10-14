import type { SupabaseClient } from "@supabase/supabase-js";
import type { OAuthTokens } from "./mercadopago/client";
import { encryptToken, tokenAad } from "./token-crypto";

/** Base de datos con permisos de sistema (service role): las funciones de credenciales son solo del backend. */
export type CredentialsDb = Pick<SupabaseClient, "rpc">;

export type CredentialsFailure =
  /** La cuenta que vincula no tiene perfil de docente. */
  | "not_a_tutor"
  /** Faltan datos o los tokens ya vencieron. */
  | "invalid_credentials"
  /** Esa cuenta de Mercado Pago ya está vinculada a OTRO docente. */
  | "account_already_linked"
  /** Quiere cambiar de cuenta pero tiene reservas por dar con la actual. */
  | "has_active_bookings"
  /** Quiere cambiar de cuenta pero tiene reembolsos sin cerrar con la actual. */
  | "has_pending_refunds"
  /** El docente no tiene una cuenta vinculada (no hay nada que renovar). */
  | "not_linked"
  /** La base no respondió o falló de forma inesperada: reintentar puede salir bien. */
  | "unavailable";

/**
 * Error al guardar o renovar las credenciales. El mensaje nunca incluye tokens, el id de la cuenta ni el
 * texto del error de la base: solo el motivo, que ya es un código cerrado.
 */
export class CredentialsError extends Error {
  constructor(readonly reason: CredentialsFailure) {
    super(`No se pudieron guardar las credenciales de cobro (${reason}).`);
    this.name = "CredentialsError";
  }
}

const SAVE_HINTS: readonly CredentialsFailure[] = [
  "not_a_tutor",
  "invalid_credentials",
  "account_already_linked",
  "has_active_bookings",
  "has_pending_refunds",
];
const ROTATE_HINTS: readonly CredentialsFailure[] = ["not_linked", "invalid_credentials"];

/** El `hint` de la función SQL es el código del error; cualquier otra cosa es una falla inesperada. */
function failureFromHint(hint: string | null | undefined, known: readonly CredentialsFailure[]): CredentialsFailure {
  return known.find((reason) => reason === hint) ?? "unavailable";
}

function isoOrThrow(date: Date): string {
  if (Number.isNaN(date.getTime())) throw new CredentialsError("invalid_credentials");
  return date.toISOString();
}

/**
 * Guarda (o reemplaza) la cuenta de cobro de un docente: cifra los dos tokens con la clave del servidor,
 * atados a ESE docente (`tokenAad`: un token copiado a la fila de otro no se descifra) y llama a
 * `save_mp_credentials`, que valida y guarda todo en una transacción. Los tokens en claro no salen de acá.
 */
export async function saveSellerCredentials(
  db: CredentialsDb,
  { tutorId, tokens, key }: { tutorId: string; tokens: OAuthTokens; key: Buffer },
): Promise<void> {
  const expiresAt = isoOrThrow(tokens.expiresAt);
  const { error } = await db.rpc("save_mp_credentials", {
    p_tutor_id: tutorId,
    p_mp_user_id: tokens.mpUserId,
    p_access_token: encryptToken(tokens.accessToken, key, tokenAad(tutorId, "access")),
    p_refresh_token: encryptToken(tokens.refreshToken, key, tokenAad(tutorId, "refresh")),
    p_public_key: tokens.publicKey,
    p_expires_at: expiresAt,
    p_live_mode: tokens.liveMode,
  });
  if (error) throw new CredentialsError(failureFromHint(error.hint, SAVE_HINTS));
}

/**
 * Guarda los tokens renovados de un docente ya vinculado (no cambia de cuenta). Misma regla de cifrado
 * que `saveSellerCredentials`.
 */
export async function rotateSellerCredentials(
  db: CredentialsDb,
  {
    tutorId,
    accessToken,
    refreshToken,
    expiresAt,
    key,
  }: { tutorId: string; accessToken: string; refreshToken: string; expiresAt: Date; key: Buffer },
): Promise<void> {
  const expires = isoOrThrow(expiresAt);
  const { error } = await db.rpc("rotate_mp_tokens", {
    p_tutor_id: tutorId,
    p_access_token: encryptToken(accessToken, key, tokenAad(tutorId, "access")),
    p_refresh_token: encryptToken(refreshToken, key, tokenAad(tutorId, "refresh")),
    p_expires_at: expires,
  });
  if (error) throw new CredentialsError(failureFromHint(error.hint, ROTATE_HINTS));
}
