import { z } from "zod";
import { MercadoPagoError } from "./mercadopago/errors";
import type { PaymentProvider } from "./provider";
import { executeRefund, refundRowSchema, type PaymentsRpc } from "./refunds";
import { SellerTokenError, type SellerToken } from "./seller-token";

/**
 * Procesa el aviso de un pago de Mercado Pago. El aviso es solo una pista de «mirá este pago»:
 * se consulta el pago al proveedor (la fuente de verdad) y se le pasa a la base, que decide
 * (`apply_payment_notification`, migración 0012). Acá no hay reglas de dinero: solo se orquesta.
 *
 * Como siempre se actúa sobre el estado ACTUAL del pago, no importa en qué orden lleguen los
 * avisos ni cuántas veces se repitan.
 */
export type NotificationDeps = {
  db: PaymentsRpc;
  provider: PaymentProvider;
  loadSellerToken: (mpUserId: string) => Promise<SellerToken>;
};

export type NotificationResult =
  /** Resuelto (incluye «no había nada que hacer»). */
  | { kind: "done"; outcome: string; detail: string | null }
  /** Algo raro que no se arregla reintentando: queda anotado para que lo revise una persona. */
  | { kind: "attention"; reason: string }
  /** Falla pasajera: se responde con error para que Mercado Pago reintente más tarde. */
  | { kind: "retry"; reason: string };

const applyResultSchema = z.object({
  outcome: z.string(),
  detail: z.string().nullish(),
  booking_id: z.string().nullish(),
  refund: refundRowSchema.nullish(),
});

const done = (outcome: string, detail: string | null = null): NotificationResult => ({ kind: "done", outcome, detail });
const attention = (reason: string): NotificationResult => ({ kind: "attention", reason });
const retry = (reason: string): NotificationResult => ({ kind: "retry", reason });

export async function processPaymentNotification(
  { db, provider, loadSellerToken }: NotificationDeps,
  { dataId, userId }: { dataId: string; userId: string | null },
): Promise<NotificationResult> {
  // El aviso trae la cuenta de cobro afectada: con su token se consulta el pago.
  if (!userId) return attention("sin_cuenta_de_cobro");

  let seller: SellerToken;
  try {
    seller = await loadSellerToken(userId);
  } catch (error) {
    if (!(error instanceof SellerTokenError)) throw error;
    // Una cuenta que no conocemos no se arregla reintentando; un token vencido o ilegible sí (se renueva o se corrige).
    return error.reason === "unknown_seller" ? attention("cuenta_de_cobro_desconocida") : retry(`token_${error.reason}`);
  }

  let payment;
  try {
    payment = await provider.getPayment({ accessToken: seller.accessToken }, dataId);
  } catch (error) {
    if (!(error instanceof MercadoPagoError)) throw error;
    // También el 404: Mercado Pago a veces avisa antes de que el pago se pueda consultar.
    return retry(`consulta_del_pago: ${error.message}`);
  }
  if (payment.id !== dataId) return attention("pago_distinto_al_avisado");

  const reference = z.uuid().safeParse(payment.externalReference);
  const { data, error } = await db.rpc("apply_payment_notification", {
    p_mp_payment_id: payment.id,
    p_booking_id: reference.success ? reference.data : null,
    p_status: payment.status,
    p_amount: payment.amount,
    p_currency: payment.currency,
    p_collector_id: payment.collectorId,
    p_refunded_amount: payment.refundedAmount,
  });
  if (error) {
    return error.hint === "invalid_notification" ? attention("aviso_inválido") : retry(`base: ${error.message}`);
  }

  const result = applyResultSchema.safeParse(data);
  // La base ya decidió y pudo haber cambiado cosas: no se reintenta a ciegas.
  if (!result.success) return attention("respuesta_inesperada_de_la_base");
  const { outcome, detail, refund } = result.data;

  switch (outcome) {
    case "reembolso_encolado":
    case "reembolso_existente": {
      if (!refund) return attention("reembolso_sin_datos");
      const execution = await executeRefund({ db, provider, accessToken: seller.accessToken }, refund);
      if (execution.status === "aprobado") return done(outcome, detail ?? null);
      return execution.retryable
        ? retry(`reembolso_pendiente: ${execution.detail}`)
        : attention(`reembolso_fallido: ${execution.detail}`);
    }
    case "requiere_revision":
      return attention(`requiere_revision:${detail ?? "sin_detalle"}`);
    case "confirmada":
    case "ya_confirmada":
    case "ya_reembolsada":
    case "reembolso_confirmado":
    case "pendiente":
    case "rechazada":
    case "ignorado":
      return done(outcome, detail ?? null);
    default:
      // La base devolvió un resultado que este código no conoce (migración más nueva que el servidor).
      return attention(`resultado_desconocido:${outcome}`);
  }
}
