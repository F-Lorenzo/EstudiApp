/**
 * Minutos que una reserva sin pagar retiene el horario. Tiene que coincidir con
 * el intervalo de `sync_bookings()` y de `confirm_booking_payment()` en la
 * migración 0008.
 */
export const HOLD_MINUTES = 15;

/**
 * Anticipación mínima para reservar un horario (minutos). Tiene que coincidir
 * con `create_booking()`: un horario que empieza antes no se puede reservar y
 * por eso no se ofrece.
 */
export const BOOKING_LEAD_MINUTES = 60;

/** Instante en que vence la reserva pendiente de pago. */
export function holdExpiresAt(createdAtIso: string) {
  return new Date(new Date(createdAtIso).getTime() + HOLD_MINUTES * 60_000);
}

/** Primer instante (ISO) en que un horario todavía se puede reservar. */
export function earliestBookableIso() {
  return new Date(new Date().getTime() + BOOKING_LEAD_MINUTES * 60_000).toISOString();
}
