"use server";

import { redirect } from "next/navigation";
import { getMockSession } from "@/lib/mock/session";
import { updatePasswordSchema } from "@/lib/validation/auth";
import type { ActionState } from "@/lib/validation/form-state";

// MOCK — SIN DB: sin proveedor de email no hay un link de recuperación
// real, así que esto actualiza la contraseña de la sesión mock actual en
// vez de la de una sesión de recuperación.
export async function updatePassword(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = updatePasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const profile = await getMockSession();
  if (!profile) {
    return { error: "Iniciá sesión primero para poder cambiar la contraseña." };
  }

  profile.password = parsed.data.password;
  redirect("/login");
}
