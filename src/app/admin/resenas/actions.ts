"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/auth/viewer";
import { decisionErrorMessage } from "@/lib/ratings/appeals";
import { createClient } from "@/lib/supabase/server";
import { appealDecisionSchema } from "@/lib/validation/appeal";
import { echoValues, type ActionState } from "@/lib/validation/form-state";

/**
 * La administración acepta (quita la reseña) o rechaza (con una respuesta para el docente) una apelación. Se verifica
 * el rol acá también; la barrera real es `decide_rating_appeal` (migración 0027), que además deja la decisión en el
 * registro de acciones.
 */
export async function decideAppeal(
  appealId: string,
  accept: boolean,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = echoValues(formData, ["response"]);
  const viewer = await getViewer();
  if (viewer?.role !== "administrador") return { error: "No tenés permiso para decidir apelaciones.", values };

  const parsed = appealDecisionSchema.safeParse({ accept, response: formData.get("response") ?? undefined });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, values };

  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_rating_appeal", {
    p_appeal: appealId,
    p_accept: parsed.data.accept,
    p_response: parsed.data.response,
  });
  if (error) {
    if (!error.hint) {
      console.error(JSON.stringify({ source: "appeals", message: "no se pudo decidir la apelación", appealId, code: error.code }));
    }
    if (error.hint === "already_decided") revalidatePath("/admin/resenas");
    return { error: decisionErrorMessage(error.hint), values };
  }

  revalidatePath("/admin/resenas");
  revalidatePath("/admin/registro");
  revalidatePath("/admin/comision");
  revalidatePath("/docente/resenas");
  revalidatePath("/docentes", "layout");
  return { success: true };
}
