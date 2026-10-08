/**
 * Política de cancelación y reembolso. Es el espejo de `refund_percent()` en la migración 0011: la
 * base decide de verdad cuánto se devuelve; esto solo sirve para MOSTRARLE a la persona, antes de
 * confirmar, cuánto va a recibir. Los dos se prueban con la misma tabla de casos límite
 * (`supabase/tests/fixtures/refund-policy-cases.json`).
 *
 *  - 24 horas o más antes de la clase: 100 %.
 *  - Menos de 24 horas y 2 horas o más: 50 %.
 *  - Menos de 2 horas: nada.
 *  - Si cancela el docente (o la administración): siempre 100 %.
 */
export const FULL_REFUND_HOURS = 24;
export const PARTIAL_REFUND_HOURS = 2;
export const PARTIAL_REFUND_PERCENT = 50;

const MINUTE = 60_000;

export type RefundPercent = 0 | 50 | 100;

export function refundPercent({
  startsAt,
  at,
  tutorOrAdmin = false,
}: {
  startsAt: Date | string;
  at: Date | string;
  tutorOrAdmin?: boolean;
}): RefundPercent {
  if (tutorOrAdmin) return 100;
  const minutesBefore = (new Date(startsAt).getTime() - new Date(at).getTime()) / MINUTE;
  if (minutesBefore >= FULL_REFUND_HOURS * 60) return 100;
  if (minutesBefore >= PARTIAL_REFUND_HOURS * 60) return PARTIAL_REFUND_PERCENT;
  return 0;
}

/** Monto a devolver de un precio, redondeado a centavos como en la base. */
export function refundAmount(price: number, percent: number) {
  return Math.round(price * percent) / 100;
}

/** Texto para la pantalla de cancelación. */
export function refundExplanation(percent: RefundPercent, price?: number | null) {
  const amount = price != null ? refundAmount(price, percent) : null;
  const money = (value: number) =>
    new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 })
      .format(value)
      .replace(/\s/g, " ");
  if (percent === 100)
    return amount != null
      ? `Si cancelás ahora, te devolvemos el total (${money(amount)}).`
      : "Si cancelás ahora, te devolvemos el total.";
  if (percent === PARTIAL_REFUND_PERCENT)
    return amount != null
      ? `Si cancelás ahora, te devolvemos el 50 % (${money(amount)}), porque faltan menos de 24 horas.`
      : "Si cancelás ahora, te devolvemos el 50 %, porque faltan menos de 24 horas.";
  return "Faltan menos de 2 horas para la clase: si cancelás ahora no hay reembolso.";
}
