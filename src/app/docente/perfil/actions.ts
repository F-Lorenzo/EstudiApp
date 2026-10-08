"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { tutorProfileSchema } from "@/lib/validation/tutor";
import type { ActionState } from "@/lib/validation/form-state";

export async function updateTutorProfile(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = tutorProfileSchema.safeParse({
    fullName: formData.get("fullName"),
    avatarUrl: formData.get("avatarUrl") ?? "",
    bio: formData.get("bio"),
    nivelAcademico: formData.get("nivelAcademico"),
    credentialUrl: formData.get("credentialUrl") ?? "",
    tarifaPorClase: formData.get("tarifaPorClase"),
    contactoVerificacion: formData.get("contactoVerificacion"),
    subjectIds: formData.getAll("subjectIds"),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Tu sesión expiró. Volvé a iniciar sesión." };
  }

  const {
    fullName,
    avatarUrl,
    bio,
    nivelAcademico,
    credentialUrl,
    tarifaPorClase,
    contactoVerificacion,
    subjectIds,
  } = parsed.data;

  const { error: profileError } = await supabase
    .from("profiles")
    .update({ full_name: fullName, avatar_url: avatarUrl || null })
    .eq("id", user.id);

  if (profileError) {
    return { error: "No se pudieron guardar los cambios. Intentá de nuevo." };
  }

  const { error: tutorError } = await supabase
    .from("tutor_profiles")
    .update({
      bio,
      nivel_academico: nivelAcademico,
      tarifa_por_clase: tarifaPorClase,
    })
    .eq("id", user.id);

  if (tutorError) {
    return { error: "No se pudieron guardar los cambios. Intentá de nuevo." };
  }

  // Contacto y respaldo van a la tabla privada (migración 0010). El upsert solo
  // manda estas dos columnas: la cuenta de Mercado Pago no se toca desde acá.
  const { error: privateError } = await supabase.from("tutor_private").upsert(
    {
      id: user.id,
      credential_url: credentialUrl || null,
      contacto_verificacion: contactoVerificacion,
    },
    { onConflict: "id" },
  );

  if (privateError) {
    return { error: "No se pudieron guardar los cambios. Intentá de nuevo." };
  }

  const { error: deleteError } = await supabase
    .from("tutor_subjects")
    .delete()
    .eq("tutor_id", user.id);

  if (deleteError) {
    return { error: "No se pudieron guardar las materias. Intentá de nuevo." };
  }

  const { error: insertError } = await supabase.from("tutor_subjects").insert(
    subjectIds.map((subjectId) => ({
      tutor_id: user.id,
      subject_id: subjectId,
    })),
  );

  if (insertError) {
    return { error: "No se pudieron guardar las materias. Intentá de nuevo." };
  }

  // Un perfil rechazado vuelve a la cola de revisión cuando el docente lo
  // corrige; si no, quedaría rechazado para siempre. Solo toca esa fila y solo
  // si sigue rechazada (la migración 0006 permite exactamente esta transición).
  const { error: resubmitError } = await supabase
    .from("tutor_profiles")
    .update({ verification_status: "pendiente", verification_reason: null })
    .eq("id", user.id)
    .eq("verification_status", "rechazado");

  if (resubmitError) {
    return { error: "No se pudo enviar el perfil a revisión. Intentá de nuevo." };
  }

  revalidatePath("/docente", "layout");
  return { success: true };
}
