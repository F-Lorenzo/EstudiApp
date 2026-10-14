import { handleOAuthStart } from "@/lib/payments/oauth-handlers";
import { runOAuthRoute } from "@/lib/payments/production-oauth";

// Nunca se guarda en caché: depende de la sesión y pone una cookie.
export const dynamic = "force-dynamic";

// Empieza la vinculación de la cuenta de cobro del docente (botón «Conectar mi cuenta de Mercado Pago»).
// La lógica está en `src/lib/payments/oauth-handlers.ts`; ver docs/FASE-1-PLAN.md.
export function GET(request: Request) {
  return runOAuthRoute(request, handleOAuthStart);
}
