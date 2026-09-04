"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { approveTutor as approveMockTutor, rejectTutor as rejectMockTutor } from "@/lib/mock/queries";
import { rejectTutorSchema } from "@/lib/validation/moderation";
import type { ActionState } from "@/lib/validation/form-state";

// NOTA: al aprobar/rechazar habría que notificar por email al docente
// (sección 12), pero todavía no hay un proveedor de email configurado.
// Este es el punto donde se dispararía ese envío.

export async function approveTutor(tutorId: string) {
  approveMockTutor(tutorId);

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

  rejectMockTutor(tutorId, parsed.data.reason);

  revalidatePath("/admin/docentes/pendientes");
  redirect("/admin/docentes/pendientes");
}
