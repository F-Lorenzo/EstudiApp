import type { SupabaseClient } from "@supabase/supabase-js";
import { TokenCryptoError, decryptToken, tokenAad } from "./token-crypto";

export type SellerTokenFailure =
  /** Esa cuenta de Mercado Pago no está vinculada a ningún docente. */
  | "unknown_seller"
  /** El token venció: hay que renovarlo (barrido de renovación, paso 1.4). */
  | "expired"
  /** No se pudo descifrar: la clave de cifrado no es la que se usó al guardarlo. */
  | "unreadable"
  /** La base no respondió. */
  | "lookup_failed";

export class SellerTokenError extends Error {
  constructor(readonly reason: SellerTokenFailure) {
    super(`No se pudo obtener el token de cobro del docente (${reason}).`);
    this.name = "SellerTokenError";
  }
}

export type SellerToken = { tutorId: string; accessToken: string };

/**
 * Token de la cuenta de cobro de un docente, por su id de Mercado Pago. Solo corre en el servidor con
 * la service role (la tabla `mp_credentials` no se puede leer desde la API pública).
 */
export async function loadSellerToken(
  db: Pick<SupabaseClient, "from">,
  mpUserId: string,
  { key, now = new Date() }: { key: Buffer; now?: Date },
): Promise<SellerToken> {
  const { data, error } = await db
    .from("mp_credentials")
    .select("tutor_id, access_token, expires_at")
    .eq("mp_user_id", mpUserId)
    .maybeSingle();

  if (error) throw new SellerTokenError("lookup_failed");
  if (!data) throw new SellerTokenError("unknown_seller");
  if (new Date(data.expires_at).getTime() <= now.getTime()) throw new SellerTokenError("expired");

  try {
    return { tutorId: data.tutor_id, accessToken: decryptToken(data.access_token, key, tokenAad(data.tutor_id, "access")) };
  } catch (cause) {
    if (cause instanceof TokenCryptoError) throw new SellerTokenError("unreadable");
    throw cause;
  }
}
