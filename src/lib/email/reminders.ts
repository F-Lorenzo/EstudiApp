import { sanitizeText } from "./sender";
import type { EmailRpc } from "./outbox";

/**
 * Anota en la bandeja los recordatorios de clase que tocan ahora (24 horas y 1 hora antes, a las dos partes;
 * migración 0018). Las ventanas y que no se anoten dos veces los decide la base; el envío lo hace después la
 * bandeja, en la misma pasada del mantenimiento. Se anotan aunque el envío no esté configurado: al reclamar,
 * la base descarta los de clases que ya empezaron o se cancelaron, así que nunca sale uno viejo.
 */
export async function enqueueClassReminders(db: EmailRpc): Promise<{ queued: number }> {
  const { data, error } = await db.rpc("enqueue_class_reminders");
  if (error) throw new Error(`No se pudieron anotar los recordatorios: ${sanitizeText(error.message)}`);
  return { queued: typeof data === "number" ? data : 0 };
}
