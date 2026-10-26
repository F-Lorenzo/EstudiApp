"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";
import { commissionSettingsSchema, commissionTierSchema } from "@/lib/validation/commission";
import { echoValues, type ActionState } from "@/lib/validation/form-state";

// Se verifica el rol acá también; la barrera real es la RLS de la migración 0021 (solo administración), y cada
// cambio queda en el registro de acciones por un trigger de la base.
async function requireAdmin() {
  const viewer = await getViewer();
  return viewer?.role === "administrador";
}

function refresh() {
  revalidatePath("/admin/comision");
  revalidatePath("/admin/registro");
}

const SETTINGS_FIELDS = ["base", "floor"];
const TIER_FIELDS = ["minReviews", "minRating", "rate"];

export async function saveCommissionSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await requireAdmin())) return { error: "No tenés permiso para cambiar la comisión." };

  const parsed = commissionSettingsSchema.safeParse({
    enabled: formData.get("enabled") ?? undefined,
    base: formData.get("base") ?? "",
    floor: formData.get("floor") ?? "",
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors, values: echoValues(formData, SETTINGS_FIELDS) };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("commission_settings")
    .update({ enabled: parsed.data.enabled, base_rate: parsed.data.base, floor_rate: parsed.data.floor })
    .eq("id", true)
    .select("id");
  if (error || !data?.length) {
    return { error: "No se pudo guardar la configuración. Intentá de nuevo.", values: echoValues(formData, SETTINGS_FIELDS) };
  }
  refresh();
  return { success: true };
}

/** Crea un escalón (sin `tierId`) o cambia uno existente. */
export async function saveCommissionTier(
  tierId: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!(await requireAdmin())) return { error: "No tenés permiso para cambiar la comisión." };

  const parsed = commissionTierSchema.safeParse({
    minReviews: formData.get("minReviews") ?? "",
    minRating: formData.get("minRating") ?? "",
    rate: formData.get("rate") ?? "",
    active: formData.get("active") ?? undefined,
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors, values: echoValues(formData, TIER_FIELDS) };
  }

  const row = {
    min_reviews: parsed.data.minReviews,
    min_rating: parsed.data.minRating,
    rate: parsed.data.rate,
    active: parsed.data.active,
  };
  const supabase = await createClient();
  const { data, error } = tierId
    ? await supabase.from("commission_tiers").update(row).eq("id", tierId).select("id")
    : await supabase.from("commission_tiers").insert(row).select("id");
  if (error || !data?.length) {
    return { error: "No se pudo guardar el escalón. Intentá de nuevo.", values: echoValues(formData, TIER_FIELDS) };
  }
  refresh();
  return { success: true };
}

export async function deleteCommissionTier(tierId: string): Promise<ActionState> {
  if (!(await requireAdmin())) return { error: "No tenés permiso para cambiar la comisión." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("commission_tiers").delete().eq("id", tierId).select("id");
  if (error || !data?.length) return { error: "No se pudo borrar el escalón. Intentá de nuevo." };
  refresh();
  return { success: true };
}
