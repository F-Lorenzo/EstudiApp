"use server";

import { requestPasswordResetSchema } from "@/lib/validation/auth";
import type { ActionState } from "@/lib/validation/form-state";

// MOCK — SIN DB: no hay proveedor de email en este modo, así que no se
// envía nada de verdad. Se simula el mismo mensaje de éxito neutro que
// tendría la versión real (no reveles si el email existe o no).
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

  return { success: true };
}
