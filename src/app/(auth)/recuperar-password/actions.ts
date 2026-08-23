"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { requestPasswordResetSchema } from "@/lib/validation/auth";
import type { ActionState } from "@/lib/validation/form-state";

export async function requestPasswordReset(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = requestPasswordResetSchema.safeParse({
    email: formData.get("email"),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL ?? (await headers()).get("origin");

  // No informamos si el email existe o no, para no filtrar qué cuentas
  // están registradas.
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${origin}/auth/confirm?type=recovery&next=/actualizar-password`,
  });

  return { success: true };
}
