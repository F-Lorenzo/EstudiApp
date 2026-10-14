/**
 * Registro mínimo del módulo de emails. Cada línea es un JSON con `source: "email"`, igual que el resto
 * de los registros de servidor. NUNCA recibe direcciones de email, cuerpos de mensajes ni claves: quien
 * llama pasa solo ids de filas, tipos de aviso y mensajes ya saneados (ver `sanitizeText`).
 */
export type EmailLog = (message: string, data?: Record<string, unknown>) => void;

export const defaultLog: EmailLog = (message, data) => {
  console.error(JSON.stringify({ source: "email", message, ...data }));
};

const warned = new Set<string>();

/**
 * Avisa UNA sola vez por proceso de cada problema de configuración: sin esto, un servidor sin Resend
 * configurado repetiría la misma línea en cada reserva y cada aviso de pago.
 */
export function warnOnce(key: string, message: string, log: EmailLog = defaultLog) {
  if (warned.has(key)) return;
  warned.add(key);
  log(message, { warning: key });
}

/** Solo para las pruebas: vuelve a permitir los avisos de una sola vez. */
export function resetWarnings() {
  warned.clear();
}
