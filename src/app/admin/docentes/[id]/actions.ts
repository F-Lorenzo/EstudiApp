"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { rejectTutorSchema } from "@/lib/validation/moderation";
import type { ActionState } from "@/lib/validation/form-state";

// NOTA: al aprobar/rechazar habría que notificar por email al docente
// (sección 12), pero todavía no hay un proveedor de email configurado.
// Este es el punto donde se dispararía ese envío.

export async function approveTutor(tutorId: string) {
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
  const parsed = rejectTutorSchema.safeParse({
    reason: formData.get("reason"),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
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
    return { error: "No se pudo rechazar el perfil. Intentá de nuevo." };
  }

  revalidatePath("/admin/docentes/pendientes");
  redirect("/admin/docentes/pendientes");
}
