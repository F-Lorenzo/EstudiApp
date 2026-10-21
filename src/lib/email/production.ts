import { siteUrlOrNull } from "@/lib/payments/site-url";
import { runtimeEnv } from "@/lib/runtime-env";
import { createAdminClient } from "@/lib/supabase/admin";
import { warnOnce } from "./log";
import { processEmailOutbox, type EmailRpc, type OutboxReport } from "./outbox";
import { createResendSender } from "./resend";
import type { EmailSender } from "./sender";

/**
 * Arma las dependencias reales del envío de emails desde las variables de entorno del servidor:
 *
 *   NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY   base de datos con permisos de sistema
 *   RESEND_API_KEY                                          clave de la API de Resend
 *   EMAIL_FROM                                              remitente, p. ej. «EstudiApp <hola@dominio>»
 *   NEXT_PUBLIC_SITE_URL                                    para los enlaces de los emails (opcional)
 *
 * Falta la service role: lanza (como `createWebhookDeps`). Falta Resend: NO lanza, devuelve un sender
 * «no configurado» y la bandeja deja los emails pendientes. Falta la dirección del sitio: los emails salen
 * sin botones, con un aviso en el registro.
 */
export type EmailDeps = { db: EmailRpc; sender: EmailSender; baseUrl: string | null };

export function createEmailDeps(): EmailDeps {
  const env = runtimeEnv();
  const baseUrl = siteUrlOrNull(env);
  if (!baseUrl) {
    warnOnce("site_url_missing", "NEXT_PUBLIC_SITE_URL no está bien configurada: los emails salen sin enlaces.");
  }
  return { db: createAdminClient(), sender: createResendSender(env), baseUrl };
}

/**
 * ¿Hay con qué enviar emails? Se consulta antes de armar nada pesado, para que un servidor sin Resend o
 * sin service role no haga trabajo ni registre errores en cada reserva.
 */
export function isEmailDeliveryConfigured(env: Record<string, string | undefined> = runtimeEnv()): boolean {
  return Boolean(
    env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
      env.SUPABASE_SERVICE_ROLE_KEY?.trim() &&
      createResendSender(env).configured,
  );
}

/**
 * Un barrido completo de la bandeja: lo que hayan dejado pendiente los envíos de después de cada
 * respuesta (por una caída del proveedor, por ejemplo). Lo llama la tarea de mantenimiento programada.
 */
export function sweepEmailOutbox({ limit = 25 }: { limit?: number } = {}): Promise<OutboxReport> {
  return processEmailOutbox({ ...createEmailDeps(), limit });
}
