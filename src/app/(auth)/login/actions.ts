"use server";

import { redirect } from "next/navigation";
import { postLoginPath } from "@/lib/auth/redirect";
import type { UserRole } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { loginSchema } from "@/lib/validation/auth";
import { echoValues, type ActionState } from "@/lib/validation/form-state";

export async function login(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = echoValues(formData, ["email"]);
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors, values };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return { error: "Email o contraseña incorrectos", values };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", data.user.id)
    .single<{ role: UserRole }>();

  redirect(postLoginPath(formData.get("redirectTo"), profile?.role ?? "alumno"));
}
