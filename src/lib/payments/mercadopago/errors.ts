export type MercadoPagoErrorKind =
  /** Mercado Pago respondió con un error HTTP. */
  | "http"
  /** No se pudo hablar con Mercado Pago (red caída, DNS, conexión cortada). */
  | "network"
  /** Mercado Pago no respondió a tiempo. */
  | "timeout"
  /** Respondió bien pero con un cuerpo que no entendemos. */
  | "invalid_response"
  /** El pedido ni siquiera salió (dato inválido de nuestro lado). */
  | "invalid_request";

/**
 * Error de una llamada a Mercado Pago. `retryable` dice si repetir el mismo pedido puede salir bien
 * (red, tiempo agotado, 429, 5xx); un 400/401/403/404 repetido da lo mismo.
 *
 * El mensaje nunca incluye el token ni los datos del pedido: se registra en logs y en la base.
 */
export class MercadoPagoError extends Error {
  readonly kind: MercadoPagoErrorKind;
  readonly status: number | null;
  readonly retryable: boolean;
  readonly code: string | null;
  /** Código del primer motivo que detalla Mercado Pago (`cause[0].code`, p. ej. `2034`), si lo mandó. */
  readonly causeCode: string | null;
  /** Espera que pidió Mercado Pago (cabecera Retry-After) antes de reintentar, si la pidió. */
  readonly retryAfterMs: number | null;

  constructor(
    message: string,
    info: {
      kind: MercadoPagoErrorKind;
      status?: number | null;
      retryable: boolean;
      code?: string | null;
      causeCode?: string | null;
      retryAfterMs?: number | null;
    },
  ) {
    super(message);
    this.name = "MercadoPagoError";
    this.kind = info.kind;
    this.status = info.status ?? null;
    this.retryable = info.retryable;
    this.code = info.code ?? null;
    this.causeCode = info.causeCode ?? null;
    this.retryAfterMs = info.retryAfterMs ?? null;
  }
}

export function isRetryableStatus(status: number) {
  return status >= 500 || status === 429 || status === 408;
}
