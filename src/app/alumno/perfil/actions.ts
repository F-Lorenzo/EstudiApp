"use server";

import { revalidatePath } from "next/cache";
import { updateProfile as updateMockProfile } from "@/lib/mock/queries";
import { getMockSession } from "@/lib/mock/session";
import { updateProfileSchema } from "@/lib/validation/auth";
import type { ActionState } from "@/lib/validation/form-state";

export async function updateProfile(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = updateProfileSchema.safeParse({
    fullName: formData.get("fullName"),
    avatarUrl: formData.get("avatarUrl") ?? "",
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const profile = await getMockSession();
  if (!profile) {
    return { error: "Tu sesión expiró. Volvé a iniciar sesión." };
  }

  updateMockProfile(profile.id, {
    full_name: parsed.data.fullName,
    avatar_url: parsed.data.avatarUrl || null,
  });

  revalidatePath("/alumno/perfil");
  return { success: true };
}
