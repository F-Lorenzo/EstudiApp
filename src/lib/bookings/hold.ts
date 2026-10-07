/**
 * Minutos que una reserva sin pagar retiene el horario. Tiene que coincidir con
 * el intervalo de `expire_pending_bookings()` en la migración 0008.
 */
export const HOLD_MINUTES = 15;

/** Instante en que vence la reserva pendiente de pago. */
export function holdExpiresAt(createdAtIso: string) {
  return new Date(new Date(createdAtIso).getTime() + HOLD_MINUTES * 60_000);
}
