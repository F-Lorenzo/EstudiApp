import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

/**
 * Comisión por reputación (migración 0021), para el panel de administración. La regla vive en la base
 * (`commission_rate_for`); acá solo se leen la configuración, los escalones y la vista previa por docente.
 */

const num = z.union([z.number(), z.string()]).transform(Number).pipe(z.number().finite());
const maybeNum = z.union([z.number(), z.string(), z.null()]).transform((v) => (v === null ? null : Number(v)));

const settingsSchema = z.object({ enabled: z.boolean(), base_rate: num, floor_rate: num, base_name: z.string() });
const tierSchema = z.object({ id: z.string(), name: z.string(), min_reviews: num, min_rating: num, rate: num, active: z.boolean() });
const levelSchema = z.object({ tutor_id: z.string(), level_name: z.string() });
const previewSchema = z.object({
  tutor_id: z.string(),
  tutor_name: z.string().nullable(),
  reviews: num,
  average: maybeNum,
  rate_if_enabled: num,
  current_rate: num,
});

/** `baseName`: el nombre del nivel de quien no cumple ningún escalón (migración 0027). */
export type CommissionSettings = { enabled: boolean; baseRate: number; floorRate: number; baseName: string };
export type CommissionTier = { id: string; name: string; minReviews: number; minRating: number; rate: number; active: boolean };
export type CommissionPreviewRow = {
  tutorId: string;
  name: string;
  reviews: number;
  average: number | null;
  rateIfEnabled: number;
  currentRate: number;
  /** El nivel que le dan sus reseñas (migración 0027), o `null` si no se pudo leer. */
  level: string | null;
};

export async function getCommissionConfig(supabase: Pick<SupabaseClient, "from" | "rpc">) {
  const [settings, tiers, preview, levels] = await Promise.all([
    supabase.from("commission_settings").select("enabled, base_rate, floor_rate, base_name").maybeSingle(),
    supabase.from("commission_tiers").select("id, name, min_reviews, min_rating, rate, active").order("min_reviews"),
    supabase.rpc("commission_preview"),
    supabase.rpc("commission_levels"),
  ]);
  const levelOf = new Map(
    (Array.isArray(levels.data) ? levels.data : []).flatMap((row) => {
      const l = levelSchema.safeParse(row);
      return l.success ? [[l.data.tutor_id, l.data.level_name] as const] : [];
    }),
  );
  const parsedSettings = settingsSchema.safeParse(settings.data);
  if (settings.error || tiers.error || preview.error || !parsedSettings.success) return null;

  return {
    settings: {
      enabled: parsedSettings.data.enabled,
      baseRate: parsedSettings.data.base_rate,
      floorRate: parsedSettings.data.floor_rate,
      baseName: parsedSettings.data.base_name,
    } satisfies CommissionSettings,
    tiers: (tiers.data ?? []).flatMap((row): CommissionTier[] => {
      const t = tierSchema.safeParse(row);
      return t.success
        ? [{ id: t.data.id, name: t.data.name, minReviews: t.data.min_reviews, minRating: t.data.min_rating, rate: t.data.rate, active: t.data.active }]
        : [];
    }),
    preview: (Array.isArray(preview.data) ? preview.data : []).flatMap((row): CommissionPreviewRow[] => {
      const p = previewSchema.safeParse(row);
      return p.success
        ? [
            {
              tutorId: p.data.tutor_id,
              name: p.data.tutor_name?.trim() || "Docente",
              reviews: p.data.reviews,
              average: p.data.average,
              rateIfEnabled: p.data.rate_if_enabled,
              currentRate: p.data.current_rate,
              level: levelOf.get(p.data.tutor_id) ?? null,
            },
          ]
        : [];
    }),
  };
}

/** «12 %», «12,5 %». */
export function formatRate(rate: number) {
  return `${(Math.round(rate * 10000) / 100).toLocaleString("es-AR", { maximumFractionDigits: 2 })} %`;
}
