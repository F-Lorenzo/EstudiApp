import { z } from "zod";
import { EmailSendError, sanitizeText, type EmailMessage, type EmailSender } from "./sender";

/**
 * Envío de emails con Resend (https://resend.com/docs/api-reference/emails/send-email).
 *
 *   RESEND_API_KEY   clave de la API (solo servidor)
 *   EMAIL_FROM       remitente con dominio verificado en Resend, p. ej. «EstudiApp <hola@tu-dominio.com>»
 *
 * Si falta alguna, el sender queda «no configurado» (`configured === false`): la bandeja de salida no
 * reclama filas y los emails esperan pendientes hasta que se configure.
 *
 * A VERIFICAR CON LA CUENTA REAL DE RESEND (nada de esto se probó contra el servicio): el formato exacto de
 * los errores, que la cabecera `Idempotency-Key` se respete durante 24 h, y el límite de pedidos por segundo
 * (la documentación habla de 2 por segundo por defecto; por eso la bandeja espera entre un envío y otro).
 *
 * Clasificación de errores, pensada para la bandeja:
 *  - red caída, tiempo agotado (8 s), 408, 429 y 5xx: reintentables y del proveedor (cortan la tanda);
 *  - 401 y 403 (clave inválida, dominio sin verificar, remitente no permitido): casi siempre es
 *    configuración, así que también son reintentables y cortan la tanda, para no descartar emails que se
 *    pueden mandar cuando se arregle;
 *  - 409 «concurrent_idempotent_requests»: reintentable (el mismo email se está procesando);
 *  - cualquier otro 4xx (destinatario inválido, cuerpo rechazado): definitivo para ESE mensaje.
 */
const API_URL = "https://api.resend.com/emails";
const DEFAULT_TIMEOUT_MS = 8_000;

export type ResendSenderOptions = {
  apiKey?: string;
  from?: string;
  /** Se inyecta en las pruebas. */
  fetch?: typeof fetch;
  timeoutMs?: number;
  url?: string;
};

const responseSchema = z.object({ id: z.string().min(1) });
const errorBodySchema = z.object({ name: z.string().nullish(), message: z.string().nullish() });

// «Nombre <hola@dominio.com>» o «hola@dominio.com». Sin saltos de línea ni comas.
const FROM_PATTERN = /^(?:[^<>\r\n,;@]*<[^<>\s,;@]+@[^<>\s,;@]+\.[^<>\s,;@]+>|[^<>\s,;@]+@[^<>\s,;@]+\.[^<>\s,;@]+)$/;
const TO_PATTERN = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
const IDEMPOTENCY_KEY = /^[\x21-\x7e]{1,256}$/;
const ERROR_CODE = /^[a-z0-9_]{1,60}$/i;

export class ResendEmailSender implements EmailSender {
  readonly configured: boolean;
  private readonly apiKey: string;
  private readonly from: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly url: string;

  constructor(options: ResendSenderOptions = {}) {
    this.apiKey = options.apiKey?.trim() ?? "";
    this.from = options.from?.trim() ?? "";
    this.configured = this.apiKey.length > 0 && FROM_PATTERN.test(this.from);
    this.fetchImpl = options.fetch ?? ((...args) => fetch(...args));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.url = options.url ?? API_URL;
  }

  async send(message: EmailMessage): Promise<{ id: string }> {
    if (!this.configured) {
      throw new EmailSendError("El envío de emails no está configurado.", {
        kind: "not_configured",
        retryable: true,
        systemic: true,
      });
    }
    if (!TO_PATTERN.test(message.to) || message.to.length > 254) {
      throw new EmailSendError("El destinatario no tiene un email válido.", { kind: "invalid_request", retryable: false });
    }
    if (!IDEMPOTENCY_KEY.test(message.idempotencyKey)) {
      throw new EmailSendError("La clave de idempotencia no es válida.", { kind: "invalid_request", retryable: false });
    }

    let response: Response;
    try {
      response = await this.fetchImpl(this.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "Idempotency-Key": message.idempotencyKey,
        },
        body: JSON.stringify({
          from: this.from,
          to: [message.to],
          // Un asunto es una sola línea: nada que pueda colarse como otra cabecera.
          subject: message.subject.replace(/[\r\n]+/g, " ").trim(),
          html: message.html,
          text: message.text,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
        cache: "no-store",
      });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      // El mensaje del error de red puede traer la dirección del pedido o detalles del sistema: no se copia.
      throw new EmailSendError(
        timedOut ? "Resend no respondió a tiempo." : "No pudimos comunicarnos con Resend.",
        { kind: timedOut ? "timeout" : "network", retryable: true, systemic: true },
      );
    }

    const text = await response.text().catch(() => "");

    if (!response.ok) {
      const { code, message: detail } = describeErrorBody(text);
      const status = response.status;
      // Del proveedor o de la configuración: el resto de la tanda fallaría igual.
      const systemic = status === 429 || status >= 500 || status === 408 || status === 401 || status === 403;
      const retryable = systemic || (status === 409 && code === "concurrent_idempotent_requests");
      const description = detail ? `: ${sanitizeText(detail, [this.apiKey], 200)}` : "";
      throw new EmailSendError(`Resend respondió ${status}${code ? ` (${code})` : ""}${description}`, {
        kind: "http",
        status,
        code,
        retryable,
        systemic,
      });
    }

    let parsed;
    try {
      parsed = responseSchema.safeParse(JSON.parse(text));
    } catch {
      parsed = null;
    }
    if (!parsed?.success) {
      // Resend aceptó el pedido pero no entendemos qué devolvió. Reintentar es seguro: la clave de
      // idempotencia hace que devuelva el envío original en vez de mandar otro.
      throw new EmailSendError("Resend respondió algo que no se pudo leer.", {
        kind: "invalid_response",
        status: response.status,
        retryable: true,
      });
    }
    return { id: parsed.data.id };
  }
}

/** Resend responde errores como `{ statusCode, name, message }`. */
function describeErrorBody(text: string): { code: string | null; message: string | null } {
  try {
    const parsed = errorBodySchema.safeParse(JSON.parse(text));
    if (!parsed.success) return { code: null, message: null };
    const code = parsed.data.name && ERROR_CODE.test(parsed.data.name) ? parsed.data.name : null;
    return { code, message: parsed.data.message ?? null };
  } catch {
    return { code: null, message: null };
  }
}

/** Sender de producción, con las variables de entorno del servidor. */
export function createResendSender(
  env: Record<string, string | undefined> = process.env,
  overrides: Omit<ResendSenderOptions, "apiKey" | "from"> = {},
) {
  return new ResendEmailSender({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM, ...overrides });
}
