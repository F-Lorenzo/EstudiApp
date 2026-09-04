"use server";

import { redirect } from "next/navigation";
import { findProfileByEmail } from "@/lib/mock/queries";
import { setMockSession } from "@/lib/mock/session";
import { loginSchema } from "@/lib/validation/auth";
import type { ActionState } from "@/lib/validation/form-state";

// MOCK — SIN DB: valida contra los perfiles en memoria en vez de
// Supabase Auth. Ver src/lib/mock/data.ts para las credenciales de demo.
export async function login(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const profile = findProfileByEmail(parsed.data.email);

  if (!profile || profile.password !== parsed.data.password) {
    return { error: "Email o contraseña incorrectos" };
  }

  await setMockSession(profile.id);
  redirect("/");
}
