import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { siteUrlOrNull } from "@/lib/payments/site-url";
import { defaultLog, warnOnce, type EmailLog } from "./log";
import { EmailSendError, describeError, sanitizeText, type EmailSender } from "./sender";
import { renderEmail } from "./templates";

/**
 * Procesa la bandeja de salida (`email_outbox`, migración 0015): reclama los avisos pendientes, arma el
 * email de cada uno, lo envía y anota el resultado. La base decide QUÉ avisar (triggers en la misma
 * transacción que el hecho); acá solo se entrega.
 *
 * Garantías:
 *  - Sin envío configurado NO se reclama nada: las filas quedan pendientes y sin intentos gastados.
 *  - Un email se manda a lo sumo una vez por fila: la clave de idempotencia del pedido es el id de la fila,
 *    así que si el envío salió bien pero no se pudo anotar, el reintento (la bandeja lo reclama a los 5
 *    minutos) no duplica el mensaje.
 *  - Un fallo no frena a los demás, salvo que sea del proveedor (red, 429, 5xx, credenciales): ahí se corta la
 *    tanda y lo que faltaba queda «fallido» para el próximo barrido, sin gastar el resto de los intentos.
 *  - Los reintentos y su límite (5 intentos, uno cada 5 minutos) los maneja `claim_pending_emails`.
 *  - Nada de lo que se registra incluye emails, cuerpos ni claves.
 */
export type EmailRpc = Pick<SupabaseClient, "rpc">;

export type OutboxReport = {
  /** Filas que devolvió la bandeja en esta tanda. */
  claimed: number;
  sent: number;
  /** Fallos de envío (reintentables o no) y filas que no se llegaron a intentar. */
  failed: number;
  /** Descartadas sin enviar: tipo desconocido, datos incompletos o fila ilegible. */
  skipped: number;
  /** `false` si el envío no está configurado (no se tocó la bandeja). */
  configured: boolean;
};

export type ProcessOptions = {
  db: EmailRpc;
  sender: EmailSender;
  /** Cuántas filas reclamar como máximo. */
  limit?: number;
  /**
   * Origen del sitio para los enlaces de los emails. Si se omite se toma de `NEXT_PUBLIC_SITE_URL`; con
   * `null` los emails salen sin enlaces.
   */
  baseUrl?: string | null;
  log?: EmailLog;
  /**
   * Pausa entre un envío y el siguiente: Resend limita los pedidos por segundo (según su documentación,
   * 2 por defecto; a verificar en la cuenta). Se inyecta en las pruebas.
   */
  pauseMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

const DEFAULT_LIMIT = 10;
const DEFAULT_PAUSE_MS = 600;

const claimedRowSchema = z.object({
  id: z.string().min(1),
  kind: z.string(),
  attempts: z.number().int().nonnegative().catch(1),
  to_email: z.string(),
  to_name: z.string().nullish(),
  payload: z.record(z.string(), z.unknown()).catch({}),
});

type ResultStatus = "enviado" | "fallido" | "omitido";

export async function processEmailOutbox({
  db,
  sender,
  limit = DEFAULT_LIMIT,
  baseUrl,
  log = defaultLog,
  pauseMs = DEFAULT_PAUSE_MS,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: ProcessOptions): Promise<OutboxReport> {
  const report: OutboxReport = { claimed: 0, sent: 0, failed: 0, skipped: 0, configured: true };

  if (sender.configured === false) {
    warnOnce(
      "sender_not_configured",
      "El envío de emails no está configurado (falta RESEND_API_KEY o EMAIL_FROM, o EMAIL_FROM no tiene un formato válido): los emails quedan pendientes.",
      log,
    );
    return { ...report, configured: false };
  }

  // Se resuelve una vez por tanda; si la dirección del sitio no está bien configurada, los emails salen sin enlaces.
  const origin = baseUrl === undefined ? siteUrlOrNull() : baseUrl;

  const claimed = await db.rpc("claim_pending_emails", { p_limit: limit });
  if (claimed.error) {
    // La falla es de infraestructura (base caída, función sin aplicar): que lo vea quien llama.
    throw new Error(`No se pudo reclamar la bandeja de emails: ${sanitizeText(claimed.error.message)}`);
  }
  const rows: unknown[] = Array.isArray(claimed.data) ? claimed.data : [];
  report.claimed = rows.length;

  let haltedBecause: string | null = null;
  let sentAny = false;

  for (const raw of rows) {
    const parsed = claimedRowSchema.safeParse(raw);
    if (!parsed.success) {
      // Sin id no hay nada que anotar; con id, se descarta para que no vuelva a reclamarse.
      const id = (raw as { id?: unknown } | null)?.id;
      if (typeof id === "string" && id) await mark(db, id, "omitido", "La fila de la bandeja no se pudo leer.", log);
      log("fila de la bandeja ilegible", { id: typeof id === "string" ? id : null });
      report.skipped++;
      continue;
    }
    const row = parsed.data;

    // El proveedor falló en un mensaje anterior de esta tanda: este no se intenta (no gasta intento de más).
    if (haltedBecause) {
      await mark(db, row.id, "fallido", `No se intentó en esta tanda: ${haltedBecause}`, log);
      report.failed++;
      continue;
    }

    const rendered = renderEmail({ kind: row.kind, payload: row.payload, toName: row.to_name, baseUrl: origin });
    if (!rendered.ok) {
      const motivo =
        rendered.reason === "unknown_kind"
          ? `No hay plantilla para el tipo de aviso «${sanitizeText(row.kind, [], 60)}».`
          : "Faltan datos para armar el email.";
      await mark(db, row.id, "omitido", motivo, log);
      log("email omitido", { id: row.id, kind: sanitizeText(row.kind, [], 60), reason: rendered.reason });
      report.skipped++;
      continue;
    }

    if (sentAny && pauseMs > 0) await sleep(pauseMs);

    try {
      sentAny = true;
      await sender.send({
        to: row.to_email,
        subject: rendered.email.subject,
        html: rendered.email.html,
        text: rendered.email.text,
        idempotencyKey: row.id,
      });
    } catch (error) {
      const known = error instanceof EmailSendError ? error : null;
      const detail = known ? sanitizeText(known.message) : "Error inesperado al enviar el email.";
      // Un error que no conocemos se trata como pasajero del proveedor: mejor reintentar que perder el aviso.
      const retryable = known ? known.retryable : true;
      const systemic = known ? known.systemic : true;
      await mark(db, row.id, retryable ? "fallido" : "omitido", retryable ? detail : `El proveedor rechazó el email: ${detail}`, log);
      log("no se pudo enviar un email", {
        id: row.id,
        kind: sanitizeText(row.kind, [], 60),
        attempt: row.attempts,
        retryable,
        exhausted: retryable && row.attempts >= 5,
        status: known?.status ?? null,
        code: known?.code ?? null,
        error: detail,
      });
      report.failed++;
      if (systemic) haltedBecause = "el proveedor de email no estaba disponible o rechazó las credenciales.";
      continue;
    }

    // Enviado: si no se puede anotar, el reintento no duplica (misma clave de idempotencia).
    await mark(db, row.id, "enviado", null, log);
    report.sent++;
  }

  return report;
}

/** Anota el resultado de un email. Una falla acá se registra pero no corta la tanda. */
async function mark(db: EmailRpc, id: string, status: ResultStatus, error: string | null, log: EmailLog) {
  try {
    const { error: failure } = await db.rpc("mark_email_result", { p_id: id, p_status: status, p_error: error });
    if (failure) log("no se pudo anotar el resultado del email", { id, status, error: sanitizeText(failure.message) });
  } catch (cause) {
    log("no se pudo anotar el resultado del email", { id, status, error: describeError(cause) });
  }
}
