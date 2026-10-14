"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getViewer } from "@/lib/auth/viewer";
import { bookingErrorMessage, isStaleStateError } from "@/lib/bookings/errors";
import { scheduleEmailDelivery } from "@/lib/email/schedule";
import { settleCancelledBooking, type CancelRefundReport } from "@/lib/payments/cancellation";
import { createPaymentServices } from "@/lib/payments/runtime";
import { createClient } from "@/lib/supabase/server";

export type TutorCancelResult =
  | {
      ok: true;
      /** El alumno había pagado: se le devuelve el 100 %. `null` si la clase no estaba paga. */
      refund: CancelRefundReport | null;
    }
  | { ok: false; error: string };

// El motivo lo ve el alumno en su reserva cancelada.
const MAX_REASON_CHARS = 300;

const reasonSchema = z
  .string()
  .trim()
  .max(MAX_REASON_CHARS)
  .optional()
  .transform((value) => (value ? value : null));

/**
 * El DOCENTE cancela una clase suya. La función de la base (`cancel_booking`) sabe que quien cancela no es el
 * alumno, así que si la clase estaba paga el reembolso es SIEMPRE del 100 %, sin importar la anticipación. Se
 * libera el horario, se avisa por email a las dos partes y el reembolso se ejecuta contra Mercado Pago con el
 * token del propio docente (la cuenta que cobró).
 *
 * LA CANCELACIÓN NO SE DESHACE si el reembolso falla: queda pendiente y un barrido lo reintenta hasta que salga.
 */
export async function cancelTutorClass(bookingId: string, reason?: string): Promise<TutorCancelResult> {
  const parsedId = z.uuid().safeParse(bookingId);
  if (!parsedId.success) return { ok: false, error: bookingErrorMessage({ hint: "not_found" }) };
  const parsedReason = reasonSchema.safeParse(reason);
  if (!parsedReason.success) {
    return { ok: false, error: `El motivo puede tener hasta ${MAX_REASON_CHARS} caracteres.` };
  }

  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: bookingErrorMessage({ hint: "not_authenticated" }) };
  if (viewer.role !== "docente") return { ok: false, error: "Solo los docentes pueden cancelar sus clases desde acá." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cancel_booking", {
    p_booking_id: parsedId.data,
    p_reason: parsedReason.data,
  });
  if (error) {
    if (isStaleStateError(error)) revalidateAfterCancel(parsedId.data);
    return { ok: false, error: bookingErrorMessage(error) };
  }

  // La clase YA está cancelada; el reembolso se ejecuta con la cuenta de cobro de este docente.
  const { refund } = await settleCancelledBooking(data, () => {
    const services = createPaymentServices({ timeoutMs: 8_000, maxAttempts: 2 });
    return { db: services.admin, provider: services.provider, loadSellerToken: services.loadSellerToken };
  });

  revalidateAfterCancel(parsedId.data);
  // Los emails (a las dos partes, y el del reembolso) los dejó anotados la base: acá se pide enviarlos.
  scheduleEmailDelivery();
  return { ok: true, refund };
}

function revalidateAfterCancel(bookingId: string) {
  revalidatePath("/docente");
  revalidatePath(`/alumno/reservas/${bookingId}`);
  revalidatePath("/alumno", "layout");
}
