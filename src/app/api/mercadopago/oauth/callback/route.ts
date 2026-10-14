import { handleOAuthCallback } from "@/lib/payments/oauth-handlers";
import { runOAuthRoute } from "@/lib/payments/production-oauth";

// Nunca se guarda en caché: depende de la sesión, de la cookie de estado y es de un solo uso.
export const dynamic = "force-dynamic";

// Dirección de retorno del OAuth: es la «Redirect URL» cargada en la aplicación de Mercado Pago
// (https://TU-DOMINIO/api/mercadopago/oauth/callback, exactamente igual). Ver docs/MERCADO-PAGO-CUENTA.md.
export function GET(request: Request) {
  return runOAuthRoute(request, handleOAuthCallback);
}
