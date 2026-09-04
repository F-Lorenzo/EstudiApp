"use server";

import { redirect } from "next/navigation";
import { createProfile, findProfileByEmail } from "@/lib/mock/queries";
import { setMockSession } from "@/lib/mock/session";
import { registerDocenteSchema } from "@/lib/validation/auth";
import type { ActionState } from "@/lib/validation/form-state";

// Crea únicamente la cuenta (perfil + tutor_profile en estado
// "pendiente"). El formulario extendido de la sección 4 (bio, materias,
// tarifa, etc.) se completa después en /docente/perfil.
//
// MOCK — SIN DB: perfil en memoria, login directo sin confirmación de
// email (no hay proveedor de email en este modo).
export async function registerDocente(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = registerDocenteSchema.safeParse({
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

  const profile = createProfile({ email, password, fullName, role: "docente" });
  await setMockSession(profile.id);
  redirect("/");
}
