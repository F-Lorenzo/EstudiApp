import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { MercadoPagoError } from "./mercadopago/errors";
import type { PaymentProvider } from "./provider";

export type PaymentsRpc = Pick<SupabaseClient, "rpc">;

/**
 * Los pagos del pago simulado (solo desarrollo) se registran con este prefijo en `payments.mercadopago_payment_id`
 * (`simulado-<id de la reserva>`). Un id real de Mercado Pago es siempre numérico, así que no se pueden confundir.
 * Reembolsar uno no toca a ningún proveedor: nunca hubo plata.
 */
export const SIMULATED_PAYMENT_PREFIX = "simulado-";

export function isSimulatedPaymentId(mercadoPagoPaymentId: string) {
  return mercadoPagoPaymentId.startsWith(SIMULATED_PAYMENT_PREFIX);
}

/** Un reembolso de la cola (`refunds`), tal como lo devuelven las funciones de la base. */
export const refundRowSchema = z.object({
  id: z.string(),
  booking_id: z.string().nullish(),
  mercadopago_payment_id: z.string(),
  status: z.enum(["pendiente", "aprobado", "fallido"]),
  percent: z.number(),
  amount: z.number(),
  idempotency_key: z.string(),
  /** Cuenta de cobro de Mercado Pago que recibió el pago: de ella sale el reembolso (migración 0013). */
  mp_user_id: z.string().nullish(),
});
export type RefundRow = z.infer<typeof refundRowSchema>;

export type RefundExecution =
  | { status: "aprobado" }
  /** `retryable`: vale la pena volver a intentarlo (el barrido o el próximo aviso lo hacen). */
  | { status: "fallido"; retryable: boolean; detail: string };

/**
 * Ejecuta un reembolso de la cola contra el proveedor y deja el resultado en la base.
 *
 * Se puede llamar las veces que haga falta con la misma fila: la clave de idempotencia es la de la
 * fila, así que Mercado Pago devuelve la operación original en vez de devolver otra vez.
 *
 * El token se recibe aparte de la fila: es el de la cuenta de cobro que recibió el pago
 * (`refund.mp_user_id`), que quien llama busca con `loadSellerToken`. Un pago simulado no lo necesita
 * (`accessToken` puede faltar) y se da por reembolsado sin llamar al proveedor.
 *
 * SUPUESTO A VERIFICAR EN SANDBOX: el reembolso se hace con el token del docente que cobró.
 * Si Mercado Pago exigiera el de la plataforma, solo cambia qué token se le pasa a esta función.
 */
export async function executeRefund(
  { db, provider, accessToken }: { db: PaymentsRpc; provider: PaymentProvider; accessToken?: string | null },
  refund: RefundRow,
): Promise<RefundExecution> {
  if (refund.status === "aprobado") return { status: "aprobado" };

  try {
    let refundId: string;
    if (isSimulatedPaymentId(refund.mercadopago_payment_id)) {
      // Pago simulado: no existe en ningún proveedor. El identificador es único por reembolso.
      refundId = `${SIMULATED_PAYMENT_PREFIX}reembolso-${refund.id}`;
    } else {
      if (!accessToken) {
        // Sin el token de la cuenta que cobró no se puede devolver; quien llama lo reintenta cuando haya uno.
        return { status: "fallido", retryable: true, detail: "Falta el token de la cuenta de cobro." };
      }
      const result = await provider.refundPayment(
        { accessToken },
        {
          paymentId: refund.mercadopago_payment_id,
          // El 100 % es el pago completo (cuerpo vacío); un parcial lleva el monto.
          ...(refund.percent < 100 ? { amount: refund.amount } : {}),
          idempotencyKey: refund.idempotency_key,
        },
      );
      refundId = result.id;
    }

    const { error } = await db.rpc("mark_refund_result", {
      p_refund_id: refund.id,
      p_status: "aprobado",
      p_mp_refund_id: refundId,
      p_detail: null,
    });
    // El reembolso ya se hizo en Mercado Pago pero no quedó anotado: reintentar es seguro (misma clave)
    // y simplemente vuelve a anotarlo.
    if (error) return { status: "fallido", retryable: true, detail: "El reembolso se hizo pero no pudimos registrarlo." };
    return { status: "aprobado" };
  } catch (cause) {
    const known = cause instanceof MercadoPagoError;
    const detail = known ? cause.message : "Error inesperado al reembolsar.";
    // Si anotar el fallo también falla, no hay nada más que hacer: el barrido lo vuelve a intentar.
    await db
      .rpc("mark_refund_result", { p_refund_id: refund.id, p_status: "fallido", p_mp_refund_id: null, p_detail: detail })
      .then(undefined, () => undefined);
    return { status: "fallido", retryable: known ? cause.retryable : true, detail };
  }
}
