"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { updatePasswordSchema } from "@/lib/validation/auth";
import type { ActionState } from "@/lib/validation/form-state";

// Requiere la sesión de recuperación que /auth/confirm establece a partir
// del enlace enviado por email.
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

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });

  if (error) {
    return { error: "No se pudo actualizar la contraseña. Pedí un nuevo enlace." };
  }

  redirect("/login");
}
