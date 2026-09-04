"use server";

import { revalidatePath } from "next/cache";
import { updateTutorProfile as updateMockTutorProfile } from "@/lib/mock/queries";
import { getMockSession } from "@/lib/mock/session";
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

  const profile = await getMockSession();
  if (!profile) {
    return { error: "Tu sesión expiró. Volvé a iniciar sesión." };
  }

  updateMockTutorProfile(profile.id, {
    fullName: parsed.data.fullName,
    avatarUrl: parsed.data.avatarUrl || null,
    bio: parsed.data.bio,
    nivelAcademico: parsed.data.nivelAcademico,
    credentialUrl: parsed.data.credentialUrl || null,
    tarifaPorClase: parsed.data.tarifaPorClase,
    contactoVerificacion: parsed.data.contactoVerificacion,
    subjectIds: parsed.data.subjectIds,
  });

  revalidatePath("/docente/perfil");
  return { success: true };
}
