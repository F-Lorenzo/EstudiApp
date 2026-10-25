import { timingSafeEqual } from "node:crypto";

/**
 * Mantenimiento diario del cobro (lo dispara el cron de Vercel, ver vercel.json). Hace cuatro barridos
 * independientes; uno que falla no frena a los otros:
 *
 *  1. renueva los tokens de Mercado Pago de los docentes que vencen pronto,
 *  2. registra la asistencia de las clases terminadas que la esperan (puede encolar reembolsos y emails),
 *  3. reintenta los reembolsos pendientes o fallidos,
 *  4. envía los emails que quedaron pendientes en la bandeja.
 *
 * Los caminos principales (el aviso de pago, la cancelación) hacen su parte en el momento; esto es la red
 * de seguridad. Mueve dinero, así que la ruta exige un secreto propio (`CRON_SECRET`) y falla cerrada.
 */
export type MaintenanceTasks = {
  refreshTokens: () => Promise<unknown>;
  settleAttendance: () => Promise<unknown>;
  retryRefunds: () => Promise<unknown>;
  sendEmails: () => Promise<unknown>;
};

export type MaintenanceOutcome = { status: number; body: Record<string, unknown> };

export function isAuthorizedCron(authorization: string | null, secret: string | undefined): boolean {
  if (!secret || !authorization?.startsWith("Bearer ")) return false;
  const received = Buffer.from(authorization.slice("Bearer ".length));
  const expected = Buffer.from(secret);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export async function runMaintenance(
  { authorization, secret }: { authorization: string | null; secret: string | undefined },
  tasks: MaintenanceTasks,
  log: (message: string, data?: Record<string, unknown>) => void = (message, data) =>
    console.error(JSON.stringify({ source: "payments-maintenance", message, ...data })),
): Promise<MaintenanceOutcome> {
  // Sin secreto configurado no se corre nada (nunca queda abierta); con uno equivocado, tampoco.
  if (!secret) return { status: 500, body: { status: "not_configured" } };
  if (!isAuthorizedCron(authorization, secret)) return { status: 401, body: { status: "unauthorized" } };

  const results: Record<string, unknown> = {};
  let failed = false;
  for (const name of ["refreshTokens", "settleAttendance", "retryRefunds", "sendEmails"] as const) {
    try {
      results[name] = await tasks[name]();
    } catch (error) {
      failed = true;
      // Solo el motivo: los informes y los errores no llevan tokens ni datos personales.
      results[name] = { error: "falló" };
      log("falló un barrido de mantenimiento", { task: name, error: error instanceof Error ? error.message : "desconocido" });
    }
  }
  return { status: failed ? 500 : 200, body: { status: failed ? "partial" : "ok", ...results } };
}
