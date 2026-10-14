import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createMercadoPagoClient, type MercadoPagoClientOptions } from "./mercadopago/client";
import type { PaymentProvider } from "./provider";
import { loadSellerToken, loadSellerTokenByTutor, type SellerToken } from "./seller-token";
import { parseEncryptionKey } from "./token-crypto";

/**
 * Las piezas reales del cobro para las acciones del servidor (pagar, reconciliar, cancelar con reembolso):
 * el cliente de base con permisos de sistema, el cliente de Mercado Pago y la búsqueda de los tokens de los
 * docentes. Las acciones reciben esto armado para que las pruebas puedan reemplazarlo por un proveedor
 * simulado y un Postgres de prueba.
 *
 * `createAdminClient` lanza si falta `SUPABASE_SERVICE_ROLE_KEY`. La clave de cifrado de los tokens se lee recién
 * cuando hace falta un token: un reembolso del pago simulado (solo desarrollo) no la necesita.
 */
export type PaymentServices = {
  admin: SupabaseClient;
  provider: PaymentProvider;
  loadSellerToken: (mpUserId: string) => Promise<SellerToken>;
  loadSellerTokenByTutor: (tutorId: string) => Promise<SellerToken>;
};

export function createPaymentServices(clientOptions: MercadoPagoClientOptions = {}): PaymentServices {
  const admin = createAdminClient();
  const key = () => parseEncryptionKey(process.env.MERCADOPAGO_TOKEN_ENCRYPTION_KEY);
  return {
    admin,
    provider: createMercadoPagoClient(clientOptions),
    loadSellerToken: async (mpUserId) => loadSellerToken(admin, mpUserId, { key: key() }),
    loadSellerTokenByTutor: async (tutorId) => loadSellerTokenByTutor(admin, tutorId, { key: key() }),
  };
}
