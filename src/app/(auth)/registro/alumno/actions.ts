"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { registerAlumnoSchema } from "@/lib/validation/auth";
import type { ActionState } from "@/lib/validation/form-state";

export async function registerAlumno(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = registerAlumnoSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const { fullName, email, password } = parsed.data;
  const supabase = await createClient();

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName, role: "alumno" } },
  });

  if (error) {
    return {
      error:
        error.code === "user_already_exists"
          ? "Ya existe una cuenta con ese email"
          : "No se pudo crear la cuenta. Intentá de nuevo.",
    };
  }

  redirect("/registro/confirmar-email");
}
