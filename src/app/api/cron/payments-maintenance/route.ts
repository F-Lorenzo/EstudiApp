import { sweepEmailOutbox } from "@/lib/email/production";
import { runMaintenance } from "@/lib/payments/maintenance";
import { createTokenRefreshDeps } from "@/lib/payments/production-oauth";
import { retryPendingRefunds } from "@/lib/payments/refund-sweep";
import { createPaymentServices } from "@/lib/payments/runtime";
import { refreshExpiringTokens } from "@/lib/payments/token-refresh";
import { runtimeEnv } from "@/lib/runtime-env";
import { settleAllAwaitingAttendance } from "@/lib/video/attendance-runtime";

// Mantenimiento diario del cobro: renueva tokens, registra la asistencia de las clases terminadas, reintenta
// reembolsos y envía emails pendientes.
// Lo llama el cron de Vercel (ver vercel.json) con `Authorization: Bearer $CRON_SECRET`.
// La lógica y la autorización están en `src/lib/payments/maintenance.ts`.
export async function GET(request: Request) {
  const env = runtimeEnv();
  const { status, body } = await runMaintenance(
    {
      authorization: request.headers.get("authorization"),
      // Se admite el nombre inicial de la guía de Fase 1 para no dejar cronjobs ya configurados sin servicio.
      secret: env.CRON_SECRET ?? env.MERCADOPAGO_CRON_SECRET,
    },
    {
      refreshTokens: () => refreshExpiringTokens(createTokenRefreshDeps()),
      settleAttendance: () => settleAllAwaitingAttendance(),
      retryRefunds: () => {
        const services = createPaymentServices();
        return retryPendingRefunds({
          db: services.admin,
          provider: services.provider,
          loadTokenForAccount: services.loadSellerToken,
        });
      },
      sendEmails: () => sweepEmailOutbox({ limit: 25 }),
    },
  );
  return Response.json(body, { status });
}
