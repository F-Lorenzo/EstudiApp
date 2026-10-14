import { siteUrlOrNull } from "./site-url";
import { parseEncryptionKey } from "./token-crypto";

/**
 * ¿Está configurado el cobro con Mercado Pago en este servidor? Decide si la pantalla de la reserva ofrece
 * «Pagar con Mercado Pago» o conserva el aviso de que todavía no está disponible. Nunca lanza ni devuelve
 * el valor de ninguna variable: solo un sí o un no.
 *
 * Hacen falta, todas a la vez:
 *
 *  - `MERCADOPAGO_TOKEN_ENCRYPTION_KEY` válida (32 bytes en base64): sin ella no se pueden leer los tokens de los docentes.
 *  - `SUPABASE_SERVICE_ROLE_KEY`: crear el link de pago, confirmar y reembolsar son operaciones del sistema.
 *  - `NEXT_PUBLIC_SITE_URL` válida: Mercado Pago necesita direcciones completas y fijas de retorno y de avisos.
 *  - `MERCADOPAGO_WEBHOOK_SECRET`: sin ella la ruta de avisos rechaza todo y un pago de un alumno que cierra la
 *    pestaña quedaría sin confirmar. No se ofrece cobrar si no hay cómo enterarse de los pagos.
 */
export function paymentsConfigured(env: Record<string, string | undefined> = process.env): boolean {
  if (!env.SUPABASE_SERVICE_ROLE_KEY?.trim()) return false;
  if (!env.MERCADOPAGO_WEBHOOK_SECRET?.trim()) return false;
  if (siteUrlOrNull(env) === null) return false;
  try {
    parseEncryptionKey(env.MERCADOPAGO_TOKEN_ENCRYPTION_KEY);
  } catch {
    return false;
  }
  return true;
}
