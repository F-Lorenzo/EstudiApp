import { z } from "zod";
import { verifyWebhookSignature } from "./mercadopago/signature";
import { processPaymentNotification, type NotificationDeps } from "./notifications";

/**
 * Recibe los avisos (webhooks) de Mercado Pago. Orden de trabajo, de lo más barato a lo más caro:
 *
 *  1. Con la firma inválida o ausente no se hace NADA (401). Sin clave configurada tampoco (500).
 *  2. Se anota el aviso en `payment_webhook_events` (idempotente): uno ya procesado se responde 200 sin repetirlo.
 *  3. Se consulta el pago y la base decide (ver `notifications.ts`).
 *  4. Se responde: 200 si quedó resuelto o es algo que reintentar no arregla; 500 si fue una falla
 *     pasajera, para que Mercado Pago reintente (15 min, 30 min, 6 h, 48 h, 96 h).
 *
 * Mercado Pago pide una respuesta en menos de 22 segundos; las llamadas salientes tienen tiempos
 * máximos más cortos (ver `client.ts`).
 */
export type WebhookDeps = NotificationDeps & {
  /** Clave secreta de la aplicación (`MERCADOPAGO_WEBHOOK_SECRET`). */
  secret: string | undefined;
  log?: (message: string, data?: Record<string, unknown>) => void;
};

const MAX_BODY_CHARS = 64_000;
const PAYMENT_ID = /^\d{1,20}$/;

const idLike = z.union([z.number(), z.string()]);
const bodySchema = z.object({
  id: idLike.nullish(),
  type: z.string().nullish(),
  action: z.string().nullish(),
  user_id: idLike.nullish(),
  data: z.object({ id: idLike.nullish() }).nullish(),
});

const reply = (status: number, body: Record<string, unknown>) => Response.json(body, { status });

export async function handleMercadoPagoWebhook(request: Request, deps: WebhookDeps): Promise<Response> {
  const log = deps.log ?? ((message, data) => console.error(JSON.stringify({ source: "mercadopago-webhook", message, ...data })));

  // 1. Autenticidad.
  if (!deps.secret) {
    log("MERCADOPAGO_WEBHOOK_SECRET no está configurada: no se procesan avisos");
    return reply(500, { status: "not_configured" });
  }

  // Un aviso real pesa unos cientos de bytes: no se lee nada que anuncie ser enorme.
  if (Number(request.headers.get("content-length")) > MAX_BODY_CHARS) return reply(413, { status: "too_large" });
  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) return reply(413, { status: "too_large" });

  const url = new URL(request.url);
  const queryDataId = url.searchParams.get("data.id");
  const signature = verifyWebhookSignature({
    secret: deps.secret,
    signature: request.headers.get("x-signature"),
    requestId: request.headers.get("x-request-id"),
    // La firma cubre el `data.id` de la dirección, no el del cuerpo.
    dataId: queryDataId,
  });
  if (!signature.ok) {
    log("aviso rechazado por la firma", { reason: signature.reason });
    return reply(401, { status: "invalid_signature" });
  }

  // 2. Qué dice el aviso.
  let rawBody: unknown = {};
  try {
    rawBody = text ? JSON.parse(text) : {};
  } catch {
    rawBody = {};
  }
  const parsedBody = bodySchema.safeParse(rawBody);
  if (!parsedBody.success) return reply(400, { status: "invalid_body" });
  const notification = parsedBody.data;

  const type = notification.type ?? url.searchParams.get("type") ?? url.searchParams.get("topic");
  if (type !== "payment") return reply(200, { status: "ignored", reason: "type" });

  const bodyDataId = notification.data?.id != null ? String(notification.data.id) : null;
  if (queryDataId && bodyDataId && queryDataId !== bodyDataId) return reply(400, { status: "inconsistent_data_id" });
  const dataId = queryDataId ?? bodyDataId;
  if (!dataId || !PAYMENT_ID.test(dataId)) return reply(400, { status: "invalid_data_id" });

  const userId = notification.user_id != null ? String(notification.user_id) : null;
  // Cada entrega distinta (otra acción, otro momento) es un evento distinto; un reintento de la
  // misma tiene la misma marca de tiempo y no se repite. Si se repitiera igual, no pasa nada: todo es idempotente.
  const eventId = `${notification.id ?? dataId}:${notification.action ?? type}:${signature.ts}`;

  // 3. Registro idempotente.
  const started = await deps.db.rpc("begin_payment_event", {
    p_event_id: eventId,
    p_payload: { query: { "data.id": queryDataId }, body: rawBody },
  });
  if (started.error) {
    log("no se pudo registrar el aviso", { eventId, error: started.error.message });
    return reply(500, { status: "retry" });
  }
  if (started.data === "duplicado") return reply(200, { status: "duplicate" });

  // 4. Procesamiento.
  let result;
  try {
    result = await processPaymentNotification(deps, { dataId, userId });
  } catch (error) {
    const reason = `excepción: ${error instanceof Error ? error.message : "desconocida"}`.slice(0, 300);
    log("falló el procesamiento del aviso", { eventId, reason });
    await finish(deps, eventId, reason, log);
    return reply(500, { status: "retry" });
  }

  if (result.kind === "done") {
    await finish(deps, eventId, null, log);
    return reply(200, { status: "ok", outcome: result.outcome });
  }
  log(result.kind === "retry" ? "aviso para reintentar" : "aviso que requiere revisión", { eventId, reason: result.reason });
  await finish(deps, eventId, result.reason, log);
  return result.kind === "retry" ? reply(500, { status: "retry" }) : reply(200, { status: "needs_review" });
}

/** Deja el resultado anotado. Si falla no se cambia la respuesta: el estado real ya está en la base de pagos. */
async function finish(
  deps: WebhookDeps,
  eventId: string,
  error: string | null,
  log: NonNullable<WebhookDeps["log"]>,
) {
  const { error: failure } = await deps.db.rpc("finish_payment_event", { p_event_id: eventId, p_error: error });
  if (failure) log("no se pudo cerrar el aviso", { eventId, error: failure.message });
}
