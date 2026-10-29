"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/auth/viewer";
import { appealErrorMessage } from "@/lib/ratings/appeals";
import { createClient } from "@/lib/supabase/server";
import { appealSchema } from "@/lib/validation/appeal";
import { echoValues, type ActionState } from "@/lib/validation/form-state";

/**
 * El docente apela una reseña suya de 1 o 2 estrellas. La barrera real es `appeal_rating` (migración 0027): reseña
 * propia, de menos de 3 estrellas, una sola vez y con motivo.
 */
export async function appealReview(ratingId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = echoValues(formData, ["reason"]);
  const parsed = appealSchema.safeParse({ reason: formData.get("reason") ?? "" });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, values };

  const viewer = await getViewer();
  if (!viewer) return { error: "Tu sesión expiró. Volvé a iniciar sesión.", values };
  if (viewer.role !== "docente") return { error: "Solo el docente puede apelar sus reseñas.", values };

  const supabase = await createClient();
  const { error } = await supabase.rpc("appeal_rating", { p_rating: ratingId, p_reason: parsed.data.reason });
  if (error) {
    if (!error.hint) {
      console.error(JSON.stringify({ source: "appeals", message: "no se pudo apelar", ratingId, code: error.code }));
    }
    return { error: appealErrorMessage(error.hint), values: error.hint === "already_appealed" ? undefined : values };
  }

  revalidatePath("/docente/resenas");
  revalidatePath("/admin/resenas");
  revalidatePath("/admin/registro");
  return { success: true };
}
