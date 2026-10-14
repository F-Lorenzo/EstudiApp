/**
 * Contrato con el proveedor de email. Lo implementa `resend.ts`; las pruebas usan versiones simuladas.
 * Lo único que sabe el resto del módulo del proveedor es esto.
 */
export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Misma clave = mismo email: el proveedor no lo manda dos veces aunque se repita el pedido. */
  idempotencyKey: string;
};

export interface EmailSender {
  /**
   * `false` cuando faltan variables de entorno: no se intenta enviar y la bandeja de salida ni siquiera
   * reclama filas (siguen pendientes, sin gastar intentos). Si se omite, se da por configurado.
   */
  readonly configured?: boolean;
  send(message: EmailMessage): Promise<{ id: string }>;
}

export type EmailSendErrorKind =
  /** Faltan RESEND_API_KEY o EMAIL_FROM. */
  | "not_configured"
  /** El pedido ni siquiera salió (destinatario o clave de idempotencia inválidos). */
  | "invalid_request"
  /** El proveedor respondió con un error HTTP. */
  | "http"
  /** No se pudo hablar con el proveedor. */
  | "network"
  /** El proveedor no respondió a tiempo. */
  | "timeout"
  /** Respondió bien pero con un cuerpo que no entendemos. */
  | "invalid_response";

/**
 * Error al enviar un email.
 *
 *  - `retryable`: repetir el mismo pedido más tarde puede salir bien (red, tiempo agotado, 429, 5xx, y
 *    credenciales/dominio sin configurar). La fila queda «fallida» y la bandeja la vuelve a reclamar.
 *    Si es `false` el proveedor rechazó ESE mensaje (por ejemplo, un destinatario inválido): reintentar da
 *    lo mismo y la fila se descarta («omitida») con el motivo.
 *  - `systemic`: el problema es del proveedor o de la configuración, no de este mensaje; seguir
 *    mandando el resto de la tanda sería gastar intentos para nada.
 *
 * El mensaje nunca incluye la clave de API ni el contenido o el destinatario del email: se registra en
 * logs y en la base.
 */
export class EmailSendError extends Error {
  readonly kind: EmailSendErrorKind;
  readonly status: number | null;
  readonly code: string | null;
  readonly retryable: boolean;
  readonly systemic: boolean;

  constructor(
    message: string,
    info: { kind: EmailSendErrorKind; status?: number | null; code?: string | null; retryable: boolean; systemic?: boolean },
  ) {
    super(message);
    this.name = "EmailSendError";
    this.kind = info.kind;
    this.status = info.status ?? null;
    this.code = info.code ?? null;
    this.retryable = info.retryable;
    this.systemic = info.systemic ?? false;
  }
}

/**
 * Deja un texto apto para registros y para la columna `last_error`: sin direcciones de email, sin
 * claves de Resend (`re_...`), sin la clave exacta que se indique ni encabezados `Bearer`, en una sola
 * línea y con un largo máximo.
 */
export function sanitizeText(text: string, secrets: readonly string[] = [], max = 300): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length >= 4) out = out.split(secret).join("[oculto]");
  }
  out = out
    .replace(/Bearer\s+\S+/gi, "Bearer [oculto]")
    .replace(/\bre_[A-Za-z0-9_-]{6,}/g, "[clave]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, "[email]")
    .replace(/\s+/g, " ")
    .trim();
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}

/** El motivo de un error cualquiera, apto para registros. */
export function describeError(error: unknown, secrets: readonly string[] = []): string {
  return sanitizeText(error instanceof Error ? error.message : "desconocido", secrets);
}
