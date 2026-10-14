import { scheduleEmailDelivery } from "@/lib/email/schedule";
import { createWebhookDeps } from "@/lib/payments/production";
import { handleMercadoPagoWebhook } from "@/lib/payments/webhook-handler";

// Respuestas que se dan ANTES de procesar nada: la firma no pasó (401) o el cuerpo es enorme (413). Un
// aviso así no pudo haber anotado emails, y no hay que dejar que cualquiera dispare consultas a la base.
const REJECTED_BEFORE_PROCESSING = new Set([401, 413]);

// Dirección de los avisos de pago: se configura en la aplicación de Mercado Pago
// (Webhooks → evento «Pagos») y también viaja en cada preferencia como `notification_url`.
// La lógica está en `src/lib/payments/webhook-handler.ts`; ver docs/FASE-1-PLAN.md.
//
// Un pago aprobado confirma la reserva y la base anota los emails (reserva confirmada, nueva reserva);
// un reembolso aprobado anota el suyo. Después de responder se envían, sin demorar la respuesta ni
// cambiarla (ver `src/lib/email`).
export async function POST(request: Request) {
  let deps;
  try {
    deps = createWebhookDeps();
  } catch (error) {
    console.error(
      JSON.stringify({
        source: "mercadopago-webhook",
        message: "faltan variables de entorno del cobro",
        error: error instanceof Error ? error.message : "desconocido",
      }),
    );
    return Response.json({ status: "not_configured" }, { status: 500 });
  }
  let response: Response | undefined;
  try {
    response = await handleMercadoPagoWebhook(request, deps);
    return response;
  } finally {
    // Con cualquier resultado (también un error o un reintento): una falla a mitad de camino pudo haber
    // dejado emails anotados. `scheduleEmailDelivery` no lanza y no demora la respuesta.
    if (!response || !REJECTED_BEFORE_PROCESSING.has(response.status)) scheduleEmailDelivery();
  }
}
