import { createWebhookDeps } from "@/lib/payments/production";
import { handleMercadoPagoWebhook } from "@/lib/payments/webhook-handler";

// Dirección de los avisos de pago: se configura en la aplicación de Mercado Pago
// (Webhooks → evento «Pagos») y también viaja en cada preferencia como `notification_url`.
// La lógica está en `src/lib/payments/webhook-handler.ts`; ver docs/FASE-1-PLAN.md.
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
  return handleMercadoPagoWebhook(request, deps);
}
