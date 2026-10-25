import { cache } from "react";
import { scheduleEmailDelivery } from "@/lib/email/schedule";
import { settleCancelledBooking } from "@/lib/payments/cancellation";
import { createPaymentServices } from "@/lib/payments/runtime";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  listAwaitingAttendance,
  listViewerAwaitingAttendance,
  settleAttendanceFor,
  type AttendanceDeps,
  type AttendanceReport,
} from "./attendance";
import { createDailyClient } from "./runtime";

// Una clase cuya decisión todavía está pendiente (la sala sigue abierta) no se vuelve a consultar en cada página:
// como mucho una vez por minuto en este servidor.
const RECHECK_MS = 60_000;
const lastCheck = new Map<string, number>();

function productionDeps(daily: AttendanceDeps["daily"]): AttendanceDeps {
  return {
    admin: createAdminClient(),
    daily,
    afterAbsence: async (data) => {
      // El mismo camino que una cancelación: reembolso con la cuenta de cobro del docente y emails.
      await settleCancelledBooking(data, () => {
        const services = createPaymentServices({ timeoutMs: 8_000, maxAttempts: 2 });
        return { db: services.admin, provider: services.provider, loadSellerToken: services.loadSellerToken };
      });
      scheduleEmailDelivery();
    },
  };
}

/**
 * Pone al día la asistencia de las clases terminadas de quien está mirando (su panel, su historial, la sala),
 * antes de leerlas. Nunca lanza: si falta configuración o Daily no responde, las clases siguen esperando.
 * Se memoiza por request.
 */
export const syncViewerAttendance = cache(async (viewer: { id: string; role: string | null }) => {
  if (viewer.role !== "alumno" && viewer.role !== "docente") return;
  try {
    const supabase = await createClient();
    const now = Date.now();
    const items = (await listViewerAwaitingAttendance(supabase, { id: viewer.id, role: viewer.role })).filter(
      (item) => now - (lastCheck.get(item.id) ?? 0) >= RECHECK_MS,
    );
    if (items.length === 0) return;
    for (const item of items) lastCheck.set(item.id, now);
    if (lastCheck.size > 1_000) lastCheck.clear();
    await settleAttendanceFor(productionDeps(createDailyClient(undefined, { timeoutMs: 4_000 })), items);
  } catch (error) {
    console.error(
      JSON.stringify({
        source: "class-attendance",
        message: "no se pudo poner al día la asistencia",
        reason: error instanceof Error ? error.message : "desconocido",
      }),
    );
  }
});

/** Para el mantenimiento de cada hora (cron de Cloudflare): todas las clases que esperan su asistencia (hasta 25 por pasada). */
export async function settleAllAwaitingAttendance(): Promise<AttendanceReport> {
  const deps = productionDeps(createDailyClient());
  return settleAttendanceFor(deps, await listAwaitingAttendance(deps.admin, 25));
}
