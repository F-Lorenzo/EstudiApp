import { after } from "next/server";
import { defaultLog, warnOnce, type EmailLog } from "./log";
import { processEmailOutbox, type OutboxReport } from "./outbox";
import { createEmailDeps, isEmailDeliveryConfigured, type EmailDeps } from "./production";
import { describeError } from "./sender";

/**
 * Pide que, DESPUÉS de responder, se envíen los emails pendientes de la bandeja de salida
 * (`email_outbox`). Nunca lanza ni demora la respuesta; si el envío no está configurado, no hace nada
 * (los emails quedan pendientes y los toma el mantenimiento de cada hora).
 *
 * Contrato fijo, lo usan las acciones de reservas y el webhook:  `scheduleEmailDelivery(): void`.
 *
 * Usa `after()` de Next, que sigue corriendo cuando la respuesta ya se envió (en Vercel extiende la vida
 * de la función con `waitUntil`; ver node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md).
 * Fuera de una solicitud (pruebas, scripts) `after()` lanza: en ese caso no se hace nada, porque nadie
 * garantiza que una promesa suelta termine, y los emails siguen pendientes para el próximo barrido.
 */
export type SchedulerDeps = {
  /** `after` de Next; se inyecta en las pruebas. */
  after: (task: () => Promise<void>) => void;
  isConfigured: () => boolean;
  createDeps: () => EmailDeps;
  process: (options: EmailDeps & { limit: number }) => Promise<OutboxReport>;
  log: EmailLog;
  /** Cuántas filas procesar por tanda después de una respuesta. */
  limit: number;
};

const AFTER_RESPONSE_LIMIT = 10;

export function createEmailScheduler(deps: SchedulerDeps): () => void {
  return function schedule() {
    try {
      if (!deps.isConfigured()) {
        warnOnce(
          "delivery_not_configured",
          "Los emails no se envían: falta RESEND_API_KEY, EMAIL_FROM o la clave de servicio de Supabase. Quedan pendientes en la bandeja.",
          deps.log,
        );
        return;
      }
      deps.after(async () => {
        try {
          const report = await deps.process({ ...deps.createDeps(), limit: deps.limit });
          if (report.failed > 0) deps.log("tanda de emails con fallos", { ...report });
        } catch (error) {
          deps.log("falló el envío de emails", { error: describeError(error) });
        }
      });
    } catch {
      // `after()` fuera de una solicitud, o cualquier imprevisto: el envío es un extra, nunca debe romper
      // la reserva ni el aviso de pago que lo pidió. Los emails siguen pendientes en la bandeja.
    }
  };
}

const schedule = createEmailScheduler({
  after: (task) => after(task),
  isConfigured: () => isEmailDeliveryConfigured(),
  createDeps: createEmailDeps,
  process: processEmailOutbox,
  log: defaultLog,
  limit: AFTER_RESPONSE_LIMIT,
});

export function scheduleEmailDelivery(): void {
  schedule();
}
