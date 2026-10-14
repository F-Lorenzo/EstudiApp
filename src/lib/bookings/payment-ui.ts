import type { BookingRefund } from "./queries";

/**
 * Lógica pura de la pantalla de pago y cancelación de una reserva (la usa `booking-detail.tsx`): qué mensaje mostrar
 * según el parámetro `?pago=` de la vuelta del checkout, cada cuánto consultar mientras se confirma el pago y cómo
 * contarle a la persona cómo quedó su reembolso.
 *
 * REGLA: el parámetro de la URL solo decide QUÉ MENSAJE mostrar. Nunca confirma nada: el estado real de la reserva
 * sale siempre de la base.
 */

/** Cómo volvió el alumno de Mercado Pago (`back_urls` de la preferencia). */
export type PaymentReturn = "ok" | "pendiente" | "fallido";

export function parsePaymentReturn(value: unknown): PaymentReturn | null {
  const first = Array.isArray(value) ? value[0] : value;
  return first === "ok" || first === "pendiente" || first === "fallido" ? first : null;
}

/** Cada cuánto se vuelve a leer la reserva mientras se confirma el pago. */
export const PAYMENT_POLL_INTERVAL_MS = 3_000;
/** Pasado este tiempo se deja de insistir y se le habla con calma a la persona. */
export const PAYMENT_POLL_MAX_MS = 90_000;
/** De cada tantas lecturas, una también le pregunta a Mercado Pago por el pago (la 0, la 3, la 6...). */
export const RECONCILE_EVERY_TICKS = 3;

/** ¿Hay que mostrar «Estamos confirmando tu pago»? Solo si volvió de pagar y la reserva sigue pendiente. */
export function isConfirmingPayment(paymentReturn: PaymentReturn | null, bookingStatus: string) {
  return bookingStatus === "pendiente_pago" && (paymentReturn === "ok" || paymentReturn === "pendiente");
}

/** ¿Esta lectura también consulta a Mercado Pago? (`tick` empieza en 0) */
export function shouldReconcile(tick: number) {
  return tick % RECONCILE_EVERY_TICKS === 0;
}

/** Pesos con centavos solo cuando hacen falta (el 50 % de un precio impar tiene 50 centavos). */
export function formatPesos(amount: number) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  })
    .format(amount)
    .replace(/\s/g, " ");
}

/**
 * Cómo quedó el reembolso de una reserva cancelada, para mostrarlo en su pantalla (sale de la base, así que sigue
 * siendo cierto cuando la persona vuelve más tarde). `null` si no hay nada que decir.
 *
 * No promete plazos: cuándo se ve la plata depende del banco o de la tarjeta.
 */
export function refundSummaryText(refund: BookingRefund | null, everPaid: boolean): string | null {
  if (refund) {
    const share = refund.percent >= 100 ? "el total" : `el ${refund.percent} %`;
    return refund.status === "aprobado"
      ? `Te devolvimos ${formatPesos(refund.amount)} (${share} de lo que pagaste). Cuándo lo ves en tu cuenta depende de tu medio de pago.`
      : `Estamos procesando tu reembolso de ${formatPesos(refund.amount)} (${share} de lo que pagaste). Te avisamos por email cuando esté listo.`;
  }
  if (everPaid) return "Esta cancelación no tiene reembolso: faltaban menos de 2 horas para la clase.";
  return null;
}
