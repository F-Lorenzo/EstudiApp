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
  student_overlap: "Ya tenés una clase reservada en ese horario.",
  not_found: "No encontramos esa reserva.",
  not_cancellable: "Esta reserva ya no se puede cancelar.",
  already_started: "La clase ya empezó, así que no se puede cancelar.",
  refund_required:
    "Esta reserva ya está paga y la cancelación con reembolso todavía no está disponible. Escribinos para resolverlo.",
  not_pending: "Esta reserva ya no está pendiente de pago.",
};

type DbError = { hint?: string | null; code?: string | null } | null | undefined;

export function bookingErrorMessage(error: DbError) {
  if (error?.hint && MESSAGES[error.hint]) return MESSAGES[error.hint];
  // La función no existe: la migración 0008 todavía no se aplicó.
  if (error?.code === "PGRST202" || error?.code === "42883") {
    return "Las reservas todavía no están habilitadas en este sistema.";
  }
  return "No pudimos completar la operación. Intentá de nuevo.";
}
