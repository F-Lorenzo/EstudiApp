import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { CredentialsError, rotateSellerCredentials } from "./credentials";
import type { MercadoPagoClient, OAuthTokens } from "./mercadopago/client";
import { MercadoPagoError } from "./mercadopago/errors";
import { TokenCryptoError, decryptToken, tokenAad } from "./token-crypto";

/**
 * Barrido de mantenimiento que renueva los tokens de cobro de los docentes antes de que venzan
 * (el access_token dura 180 días y el refresh_token, 6 meses). Corre con la service role: lee
 * `mp_credentials` y guarda con `rotate_mp_tokens`.
 *
 * Reglas que NO se negocian:
 *  - El pedido de renovación a Mercado Pago NO se reintenta a ciegas. Cada canje entrega un refresh_token
 *    nuevo que reemplaza al anterior: si la respuesta se pierde, un segundo intento con el viejo puede
 *    fallar. Se sigue con el token viejo hasta que venza y el docente vuelve a vincular.
 *  - Lo que SÍ se reintenta (una vez) es guardar los tokens nuevos en la base, que es idempotente.
 *  - Un fallo de un docente no frena a los demás.
 *  - El informe no incluye tokens, ni cuentas de Mercado Pago, ni textos de error de terceros.
 *
 * A VERIFICAR EN SANDBOX: que Mercado Pago entregue un refresh_token nuevo en cada renovación y que el
 * anterior deje de servir (el código asume lo más estricto), y qué responde al renovar con el access_token
 * ya vencido pero dentro de la vigencia del refresh_token.
 */
export type RefreshFailureReason =
  /** Venció y Mercado Pago no lo renovó (o hace demasiado que venció): el docente tiene que volver a vincular. */
  | "requiere_vincular"
  /** No se pudo descifrar el refresh_token guardado: la clave de cifrado no es la que se usó al guardarlo. */
  | "token_ilegible"
  /** Mercado Pago rechazó la renovación (refresh_token inválido o revocado). El token actual sigue hasta que venza. */
  | "rechazado_por_mercadopago"
  /** Mercado Pago no respondió bien (red, tiempo agotado, 5xx). El próximo barrido lo vuelve a intentar. */
  | "mercadopago_no_disponible"
  /** Mercado Pago devolvió tokens de OTRA cuenta: no se guardan. */
  | "cuenta_distinta"
  /** Se renovó en Mercado Pago pero no se pudo guardar en la base. */
  | "guardado_fallido"
  /** El docente desvinculó su cuenta mientras corría el barrido. */
  | "ya_no_vinculada";

export type RefreshReport = {
  /** Credenciales revisadas en este barrido. */
  checked: number;
  renewed: number;
  failed: { tutorId: string; reason: RefreshFailureReason }[];
};

export type TokenRefreshDeps = {
  /** Base con permisos de sistema (service role). */
  db: Pick<SupabaseClient, "from" | "rpc">;
  client: Pick<MercadoPagoClient, "refreshAccessToken">;
  /** Clave de cifrado de los tokens (32 bytes). */
  key: Buffer;
  now?: Date;
  /** Se renuevan los tokens que vencen dentro de estos días. */
  windowDays?: number;
  /** Máximo de credenciales por barrido. */
  limit?: number;
};

export class TokenRefreshError extends Error {
  constructor() {
    super("No se pudieron leer las credenciales de cobro para renovarlas.");
    this.name = "TokenRefreshError";
  }
}

const DAY_MS = 86_400_000;
const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_LIMIT = 50;
/** Pasados estos días desde el vencimiento, ni se intenta: el refresh_token también venció. */
const EXPIRED_GRACE_DAYS = 7;
const SAVE_ATTEMPTS = 2;

const rowsSchema = z.array(
  z.object({
    tutor_id: z.string(),
    mp_user_id: z.string(),
    refresh_token: z.string(),
    expires_at: z.string(),
  }),
);
type CredentialRow = z.infer<typeof rowsSchema>[number];

const COLUMNS = "tutor_id, mp_user_id, refresh_token, expires_at";

export async function refreshExpiringTokens({
  db,
  client,
  key,
  now = new Date(),
  windowDays = DEFAULT_WINDOW_DAYS,
  limit = DEFAULT_LIMIT,
}: TokenRefreshDeps): Promise<RefreshReport> {
  const horizon = new Date(now.getTime() + windowDays * DAY_MS).toISOString();
  const nowIso = now.toISOString();

  // Primero las que todavía sirven y vencen pronto (las más urgentes); con lo que sobre del límite, las que
  // ya vencieron, las más recientes primero. Así un montón de cuentas abandonadas no deja sin renovar a las demás.
  const upcoming = await selectRows(
    db
      .from("mp_credentials")
      .select(COLUMNS)
      .gt("expires_at", nowIso)
      .lte("expires_at", horizon)
      .order("expires_at", { ascending: true })
      .limit(limit),
  );
  const expired =
    upcoming.length < limit
      ? await selectRows(
          db
            .from("mp_credentials")
            .select(COLUMNS)
            .lte("expires_at", nowIso)
            .order("expires_at", { ascending: false })
            .limit(limit - upcoming.length),
        )
      : [];

  const report: RefreshReport = { checked: 0, renewed: 0, failed: [] };

  for (const row of [...upcoming, ...expired]) {
    report.checked++;
    const outcome = await refreshOne(row, { db, client, key, now });
    if (outcome === "renewed") report.renewed++;
    else report.failed.push({ tutorId: row.tutor_id, reason: outcome });
  }
  return report;
}

async function selectRows(query: PromiseLike<{ data: unknown; error: unknown }>): Promise<CredentialRow[]> {
  const { data, error } = await query;
  const parsed = rowsSchema.safeParse(data ?? []);
  if (error || !parsed.success) throw new TokenRefreshError();
  return parsed.data;
}

async function refreshOne(
  row: CredentialRow,
  { db, client, key, now }: { db: TokenRefreshDeps["db"]; client: TokenRefreshDeps["client"]; key: Buffer; now: Date },
): Promise<"renewed" | RefreshFailureReason> {
  const expiresAt = new Date(row.expires_at).getTime();
  const expired = expiresAt <= now.getTime();

  // Hace demasiado que venció: no se gasta un pedido en algo que no puede salir bien.
  if (expired && now.getTime() - expiresAt > EXPIRED_GRACE_DAYS * DAY_MS) return "requiere_vincular";

  let refreshToken: string;
  try {
    refreshToken = decryptToken(row.refresh_token, key, tokenAad(row.tutor_id, "refresh"));
  } catch (error) {
    if (error instanceof TokenCryptoError) return "token_ilegible";
    throw error;
  }

  // Un solo intento: ver la nota de arriba sobre por qué no se reintenta.
  let tokens: OAuthTokens;
  try {
    tokens = await client.refreshAccessToken(refreshToken);
  } catch (error) {
    // Un 4xx que no es pasajero (no 408 ni 429) es un rechazo: repetirlo da lo mismo.
    const rejected = error instanceof MercadoPagoError && error.kind === "http" && !error.retryable;
    if (rejected) return expired ? "requiere_vincular" : "rechazado_por_mercadopago";
    return "mercadopago_no_disponible";
  }

  if (tokens.mpUserId !== row.mp_user_id) return "cuenta_distinta";

  for (let attempt = 1; ; attempt++) {
    try {
      await rotateSellerCredentials(db, {
        tutorId: row.tutor_id,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        key,
      });
      return "renewed";
    } catch (error) {
      if (error instanceof CredentialsError) {
        if (error.reason === "not_linked") return "ya_no_vinculada";
        // Guardar es idempotente: si la base no respondió, se prueba una vez más antes de rendirse.
        if (error.reason === "unavailable" && attempt < SAVE_ATTEMPTS) continue;
      }
      return "guardado_fallido";
    }
  }
}
