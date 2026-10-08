import { createAdminClient } from "@/lib/supabase/admin";
import { createMercadoPagoClient } from "./mercadopago/client";
import { loadSellerToken } from "./seller-token";
import { parseEncryptionKey } from "./token-crypto";
import type { WebhookDeps } from "./webhook-handler";

/**
 * Arma las dependencias reales del cobro desde las variables de entorno del servidor. Falla (lanza)
 * si falta alguna: mejor no procesar un aviso que procesarlo a medias.
 *
 *   SUPABASE_SERVICE_ROLE_KEY            base de datos con permisos de sistema
 *   MERCADOPAGO_WEBHOOK_SECRET           firma de los avisos
 *   MERCADOPAGO_TOKEN_ENCRYPTION_KEY     descifrado de los tokens de los docentes
 *   MERCADOPAGO_CLIENT_ID / _SECRET      aplicación de Mercado Pago (vinculación, renovación)
 */
export function createWebhookDeps(): WebhookDeps {
  const admin = createAdminClient();
  const key = parseEncryptionKey(process.env.MERCADOPAGO_TOKEN_ENCRYPTION_KEY);
  return {
    secret: process.env.MERCADOPAGO_WEBHOOK_SECRET,
    db: admin,
    provider: createMercadoPagoClient(),
    loadSellerToken: (mpUserId) => loadSellerToken(admin, mpUserId, { key }),
  };
}
