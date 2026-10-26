"use server";

import { getViewer } from "@/lib/auth/viewer";
import { renderHtml, renderText } from "@/lib/email/layout";
import { createResendSender } from "@/lib/email/resend";
import { TEST_EMAIL_SUBJECT, describeTestFailure, testEmailContent } from "@/lib/email/test-email";
import { siteUrlOrNull } from "@/lib/payments/site-url";
import { runtimeEnv } from "@/lib/runtime-env";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/validation/form-state";

/**
 * Manda un email de prueba al email de la cuenta de administración que lo pide, directo con Resend (sin pasar
 * por la bandeja). Sirve para comprobar el dominio, el remitente y la clave apenas se configuran.
 */
export async function sendTestEmail(): Promise<ActionState> {
  const viewer = await getViewer();
  if (viewer?.role !== "administrador") return { error: "No tenés permiso para probar el envío de emails." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const to = user?.email?.trim();
  if (!to) return { error: "Tu cuenta no tiene un email al que mandar la prueba." };

  const env = runtimeEnv();
  const content = testEmailContent(siteUrlOrNull(env));
  try {
    await createResendSender(env).send({
      to,
      subject: TEST_EMAIL_SUBJECT,
      html: renderHtml(TEST_EMAIL_SUBJECT, content),
      text: renderText(content),
      idempotencyKey: `prueba-${crypto.randomUUID()}`,
    });
  } catch (error) {
    return { error: describeTestFailure(error) };
  }
  return { success: true };
}
