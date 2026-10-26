"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth/viewer";
import { scheduleEmailDelivery } from "@/lib/email/schedule";
import { createClient } from "@/lib/supabase/server";
import {
  deactivateTutorSchema,
  rejectTutorSchema,
  reopenTutorSchema,
} from "@/lib/validation/moderation";
import { echoValues, type ActionState } from "@/lib/validation/form-state";

// Las acciones de servidor se pueden invocar sin pasar por la pantalla (el
// proxy solo protege las páginas), así que se verifica el rol acá también.
// No reemplaza a la base: `decide_tutor_profile` (migración 0019) vuelve a
// exigir administración, valida la transición y el motivo, y deja la acción
// en el registro. El email al docente lo anota un trigger; acá solo se pide
// enviarlo después de responder.
async function requireAdmin() {
  const viewer = await getViewer();
  return viewer?.role === "administrador";
}

type Decision = "aprobar" | "rechazar" | "reabrir" | "dar_de_baja";

async function decide(tutorId: string, action: Decision, reason: string | null) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_tutor_profile", {
    p_tutor_id: tutorId,
    p_action: action,
    p_reason: reason,
  });
  if (error) return (error as { hint?: string }).hint ?? "error";
  scheduleEmailDelivery();
  for (const path of [
    "/admin/docentes/pendientes",
    "/admin/docentes/activos",
    "/admin/docentes/rechazados",
    `/admin/docentes/${tutorId}`,
    "/admin/registro",
  ])
    revalidatePath(path);
  return null;
}

/** Un mensaje para la pantalla; el detalle de la base nunca se muestra. */
function decisionError(hint: string, fallback: string) {
  return hint === "invalid_transition"
    ? "El perfil cambió mientras lo revisabas. Actualizá la página."
    : fallback;
}

export async function approveTutor(tutorId: string) {
  if (!(await requireAdmin())) {
    throw new Error("No tenés permiso para aprobar perfiles");
  }
  if (await decide(tutorId, "aprobar", null)) {
    throw new Error("No se pudo aprobar el perfil");
  }
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

  const failure = await decide(tutorId, "rechazar", parsed.data.reason);
  if (failure) {
    return {
      error: decisionError(failure, "No se pudo rechazar el perfil. Intentá de nuevo."),
      values: echoValues(formData, ["reason"]),
    };
  }

  redirect("/admin/docentes/pendientes");
}

/** Da de baja a un docente aprobado: deja de aparecer en el catálogo. Sus clases confirmadas siguen en pie. */
export async function deactivateTutor(
  tutorId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!(await requireAdmin())) {
    return { error: "No tenés permiso para dar de baja perfiles." };
  }

  const parsed = deactivateTutorSchema.safeParse({
    reason: formData.get("reason"),
  });

  if (!parsed.success) {
    return {
      fieldErrors: parsed.error.flatten().fieldErrors,
      values: echoValues(formData, ["reason"]),
    };
  }

  const failure = await decide(tutorId, "dar_de_baja", parsed.data.reason);
  if (failure) {
    return {
      error: decisionError(failure, "No se pudo dar de baja el perfil. Intentá de nuevo."),
      values: echoValues(formData, ["reason"]),
    };
  }

  redirect("/admin/docentes/rechazados");
}

/** Devuelve un perfil rechazado a la cola de revisión. La nota queda solo en el registro. */
export async function reopenTutor(
  tutorId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!(await requireAdmin())) {
    return { error: "No tenés permiso para reabrir perfiles." };
  }

  const parsed = reopenTutorSchema.safeParse({
    note: formData.get("note") ?? "",
  });

  if (!parsed.success) {
    return {
      fieldErrors: parsed.error.flatten().fieldErrors,
      values: echoValues(formData, ["note"]),
    };
  }

  const failure = await decide(tutorId, "reabrir", parsed.data.note);
  if (failure) {
    return {
      error: decisionError(failure, "No se pudo reabrir el perfil. Intentá de nuevo."),
      values: echoValues(formData, ["note"]),
    };
  }

  redirect("/admin/docentes/pendientes");
}
