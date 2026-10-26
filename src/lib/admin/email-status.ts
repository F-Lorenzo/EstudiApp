import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { siteUrlOrNull } from "@/lib/payments/site-url";
import { isValidReplyTo, isValidSender } from "@/lib/email/resend";

/**
 * Estado del envío de emails para `/admin/emails`: qué está configurado en el servidor (sin mostrar nunca la
 * clave) y cómo viene la bandeja (`email_outbox_summary`, migración 0023, que exige administración).
 */

export type EmailSetup = {
  /** Hay una clave de Resend cargada. Nunca se muestra. */
  apiKey: boolean;
  from: string | null;
  fromValid: boolean;
  replyTo: string | null;
  replyToValid: boolean;
  /** La service role, con la que el servidor lee y marca la bandeja. */
  serviceRole: boolean;
  /** Para los botones de los emails. Sin ella salen sin enlaces. */
  siteUrl: string | null;
  /** Con esto, los emails salen. */
  ready: boolean;
};

export function getEmailSetup(env: Record<string, string | undefined>): EmailSetup {
  const from = env.EMAIL_FROM?.trim() || null;
  const replyTo = env.EMAIL_REPLY_TO?.trim() || null;
  const apiKey = Boolean(env.RESEND_API_KEY?.trim());
  const fromValid = from !== null && isValidSender(from);
  const replyToValid = replyTo === null || isValidReplyTo(replyTo);
  const serviceRole = Boolean(env.NEXT_PUBLIC_SUPABASE_URL?.trim() && env.SUPABASE_SERVICE_ROLE_KEY?.trim());
  return {
    apiKey,
    from,
    fromValid,
    replyTo,
    replyToValid,
    serviceRole,
    siteUrl: siteUrlOrNull(env),
    ready: apiKey && fromValid && replyToValid && serviceRole,
  };
}

const count = z.union([z.number(), z.string()]).transform(Number).pipe(z.number().int().nonnegative());

const summarySchema = z.object({
  last_7_days: z.object({ enviado: count, pendiente: count, fallido: count, omitido: count }),
  waiting: count,
  oldest_waiting_at: z.string().nullable(),
  last_sent_at: z.string().nullable(),
  problems: z.array(
    z.object({
      kind: z.string(),
      status: z.enum(["fallido", "omitido"]),
      attempts: count,
      error: z.string().nullable(),
      at: z.string(),
    }),
  ),
});

export type EmailOutboxSummary = z.infer<typeof summarySchema>;

export async function getEmailOutboxSummary(
  supabase: Pick<SupabaseClient, "rpc">,
): Promise<{ summary: EmailOutboxSummary | null; error: boolean }> {
  const { data, error } = await supabase.rpc("email_outbox_summary");
  if (error) return { summary: null, error: true };
  const parsed = summarySchema.safeParse(data);
  return parsed.success ? { summary: parsed.data, error: false } : { summary: null, error: true };
}

const KIND_LABEL: Record<string, string> = {
  reserva_confirmada: "Reserva confirmada (alumno)",
  nueva_reserva_docente: "Nueva reserva (docente)",
  reserva_cancelada: "Clase cancelada",
  reembolso_realizado: "Reembolso",
  recordatorio_24h: "Recordatorio 24 h antes",
  recordatorio_1h: "Recordatorio 1 h antes",
  perfil_aprobado: "Perfil aprobado",
  perfil_rechazado: "Perfil rechazado",
  perfil_reabierto: "Perfil reabierto",
};

export function emailKindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}
