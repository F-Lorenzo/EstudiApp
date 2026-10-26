import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

/**
 * Métricas de la administración (`admin_metrics`, migración 0020). La base hace las cuentas y exige
 * administración; acá solo se valida la forma y se pasan los montos a número.
 */

const amount = z.union([z.number(), z.string()]).transform(Number).pipe(z.number().finite());
const count = z.union([z.number(), z.string()]).transform(Number).pipe(z.number().int().nonnegative());
const average = z.union([z.number(), z.string(), z.null()]).transform((v) => (v === null ? null : Number(v)));

const metricsSchema = z.object({
  generated_at: z.string(),
  weeks: z.array(
    z.object({
      week_start: z.string(),
      paid_bookings: count,
      classes_given: count,
      revenue: amount,
      commission: amount,
      refunded: amount,
    }),
  ),
  last_30_days: z.object({
    paid_bookings: count,
    classes_given: count,
    revenue: amount,
    commission: amount,
    tutor_amount: amount,
    refunded: amount,
    paid_cancellations: count,
    tutor_absences: count,
    expired_holds: count,
  }),
  tutors: z.object({ approved: count, pending: count, payable: count, active_30d: count }),
  students: z.object({ total: count, active_30d: count }),
  ratings: z.object({ count, average, count_30d: count, average_30d: average }),
});

export type AdminMetrics = z.infer<typeof metricsSchema>;

export async function getAdminMetrics(
  supabase: Pick<SupabaseClient, "rpc">,
  { weeks = 8 }: { weeks?: number } = {},
): Promise<{ metrics: AdminMetrics | null; error: boolean }> {
  const { data, error } = await supabase.rpc("admin_metrics", { p_weeks: weeks });
  if (error) return { metrics: null, error: true };
  const parsed = metricsSchema.safeParse(data);
  return parsed.success ? { metrics: parsed.data, error: false } : { metrics: null, error: true };
}

/** «19 oct.»: el lunes con que empieza una semana (`YYYY-MM-DD`). */
export function weekLabel(weekStart: string) {
  return new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(`${weekStart}T12:00:00Z`),
  );
}
