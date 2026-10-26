/**
 * Mensajes para los errores de las funciones de reserva (migración 0008). La
 * base devuelve un código legible en `hint`; acá se traduce a texto para la
 * persona. Nunca se muestra el mensaje técnico original.
 */
const MESSAGES: Record<string, string> = {
  not_authenticated: "Tu sesión expiró. Volvé a iniciar sesión.",
  not_student: "Solo las cuentas de estudiante pueden reservar clases.",
  slot_not_found: "Ese horario ya no existe. Elegí otro.",
  slot_taken: "Ese horario recién lo reservó otra persona. Elegí otro.",
  slot_too_soon:
    "Ese horario ya no se puede reservar: las clases se reservan con al menos una hora de anticipación.",
  tutor_unavailable: "Este docente no está disponible por ahora.",
  tutor_not_payable:
    "Este docente todavía no puede recibir pagos. Probá más tarde o elegí otro docente.",
  student_overlap: "Ya tenés una clase reservada en ese horario.",
  too_many_holds:
    "Ya tenés dos reservas sin pagar. Pagá o cancelá una para reservar otra.",
  too_many_daily_holds:
    "Hoy dejaste vencer o cancelaste muchas reservas sin pagar. Vas a poder reservar de nuevo dentro de 24 horas.",
  too_many_card_attempts_booking:
    "Ya hiciste 5 intentos de pago para esta reserva. Por seguridad no se puede volver a intentar: cancelala y reservá de nuevo.",
  too_many_card_attempts:
    "Hiciste demasiados intentos de pago en las últimas 24 horas. Por seguridad, vas a poder volver a intentar mañana.",
  not_found: "No encontramos esa reserva.",
  not_cancellable: "Esta reserva ya no se puede cancelar.",
  already_started: "La clase ya empezó, así que no se puede cancelar.",
  invalid_payment:
    "No pudimos preparar el reembolso de esta reserva, así que no la cancelamos. Escribinos y lo resolvemos.",
  not_pending: "Esta reserva ya no está pendiente de pago.",
  hold_expired: "Pasaron los 15 minutos y la reserva venció.",
  class_started: "La clase ya empezó.",
};

/**
 * Errores que significan «lo que ves ya no es así»: otra persona tomó el
 * horario, la reserva venció, se canceló desde otra pestaña. Después de uno de
 * estos hay que volver a leer la pantalla, porque repetir el pedido da el mismo
 * error.
 */
const STALE_STATE = new Set([
  "slot_not_found",
  "slot_taken",
  "slot_too_soon",
  "tutor_unavailable",
  "not_found",
  "not_cancellable",
  "not_pending",
  "hold_expired",
  "class_started",
]);

export function isStaleStateError(error: DbError) {
  return Boolean(error?.hint && STALE_STATE.has(error.hint));
}

type DbError = { hint?: string | null; code?: string | null } | null | undefined;

export function bookingErrorMessage(error: DbError) {
  if (error?.hint && MESSAGES[error.hint]) return MESSAGES[error.hint];
  // La función no existe: la migración 0008 todavía no se aplicó.
  if (error?.code === "PGRST202" || error?.code === "42883") {
    return "Las reservas todavía no están habilitadas en este sistema.";
  }
  return "No pudimos completar la operación. Intentá de nuevo.";
}
