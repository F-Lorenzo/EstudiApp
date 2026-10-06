"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";
import { rejectTutorSchema } from "@/lib/validation/moderation";
import { echoValues, type ActionState } from "@/lib/validation/form-state";

// Las acciones de servidor se pueden invocar sin pasar por la pantalla (el
// proxy solo protege las páginas), así que se verifica el rol acá también.
// No reemplaza a la RLS: es una segunda barrera.
async function requireAdmin() {
  const viewer = await getViewer();
  return viewer?.role === "administrador";
}

// NOTA: al aprobar/rechazar habría que notificar por email al docente
// (sección 12), pero todavía no hay un proveedor de email configurado.
// Este es el punto donde se dispararía ese envío.

export async function approveTutor(tutorId: string) {
  if (!(await requireAdmin())) {
    throw new Error("No tenés permiso para aprobar perfiles");
  }
  const supabase = await createClient();

  const { error } = await supabase
    .from("tutor_profiles")
    .update({ verification_status: "aprobado", verification_reason: null })
    .eq("id", tutorId);

  if (error) {
    throw new Error("No se pudo aprobar el perfil");
  }

  revalidatePath("/admin/docentes/pendientes");
  revalidatePath("/admin/docentes/activos");
  redirect("/admin/docentes/pendientes");
}

export async function rejectTutor(
  tutorId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!(await requireAdmin())) {
    return { error: "No tenés permiso para rechazar perfiles." };
  }

  const parsed = rejectTutorSchema.safeParse({
    reason: formData.get("reason"),
  });

  if (!parsed.success) {
    return {
      fieldErrors: parsed.error.flatten().fieldErrors,
      values: echoValues(formData, ["reason"]),
    };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("tutor_profiles")
    .update({
      verification_status: "rechazado",
      verification_reason: parsed.data.reason,
    })
    .eq("id", tutorId);

  if (error) {
    return {
      error: "No se pudo rechazar el perfil. Intentá de nuevo.",
      values: echoValues(formData, ["reason"]),
    };
  }

  revalidatePath("/admin/docentes/pendientes");
  redirect("/admin/docentes/pendientes");
}
