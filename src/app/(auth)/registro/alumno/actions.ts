"use server";

import { redirect } from "next/navigation";
import { createProfile, findProfileByEmail } from "@/lib/mock/queries";
import { setMockSession } from "@/lib/mock/session";
import { registerAlumnoSchema } from "@/lib/validation/auth";
import type { ActionState } from "@/lib/validation/form-state";

// MOCK — SIN DB: crea el perfil en memoria y loguea directo, sin
// confirmación de email (no hay proveedor de email en este modo).
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

  if (findProfileByEmail(email)) {
    return { error: "Ya existe una cuenta con ese email" };
  }

  const profile = createProfile({ email, password, fullName, role: "alumno" });
  await setMockSession(profile.id);
  redirect("/");
}
