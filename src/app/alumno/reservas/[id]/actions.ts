"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getViewer } from "@/lib/auth/viewer";
import { bookingErrorMessage, isStaleStateError } from "@/lib/bookings/errors";
import { getStudentBooking } from "@/lib/bookings/queries";
import { paymentSimulationEnabled } from "@/lib/bookings/simulation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type BookingActionResult = { ok: true } | { ok: false; error: string };

function refresh(bookingId: string) {
  revalidatePath(`/alumno/reservas/${bookingId}`);
  revalidatePath("/alumno", "layout");
}

/**
 * Cuando una operación falla porque la reserva cambió (venció, se canceló desde
 * otra pestaña), se vuelve a leer la pantalla: si no, seguiría mostrando el pago
 * pendiente con sus botones y cada intento repetiría el mismo error.
 */
function failed(bookingId: string, error: Parameters<typeof bookingErrorMessage>[0]) {
  if (isStaleStateError(error)) refresh(bookingId);
  return { ok: false, error: bookingErrorMessage(error) } as const;
}

/** Cancela una reserva del alumno (la función de la base valida las reglas). */
export async function cancelBooking(bookingId: string): Promise<BookingActionResult> {
  const parsed = z.uuid().safeParse(bookingId);
  if (!parsed.success) {
    return { ok: false, error: bookingErrorMessage({ hint: "not_found" }) };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_booking", {
    p_booking_id: parsed.data,
    p_reason: null,
  });
  if (error) return failed(parsed.data, error);

  refresh(parsed.data);
  return { ok: true };
}

/**
 * Confirma el pago sin cobrar. Solo existe para probar el recorrido mientras no
 * esté Mercado Pago, y únicamente si se habilitó a propósito. Comprueba que la
 * reserva sea del alumno y siga pendiente; la confirmación en sí la hace la
 * función `confirm_booking_payment`, que solo ejecuta la service role.
 */
export async function simulatePayment(bookingId: string): Promise<BookingActionResult> {
  if (!paymentSimulationEnabled()) {
    return { ok: false, error: "El pago simulado no está habilitado." };
  }
  const parsed = z.uuid().safeParse(bookingId);
  const viewer = await getViewer();
  if (!parsed.success || !viewer) {
    return { ok: false, error: bookingErrorMessage({ hint: "not_found" }) };
  }

  const supabase = await createClient();
  let booking;
  try {
    booking = await getStudentBooking(supabase, parsed.data, viewer.id);
  } catch {
    return { ok: false, error: bookingErrorMessage(null) };
  }
  if (!booking) return { ok: false, error: bookingErrorMessage({ hint: "not_found" }) };
  if (booking.status !== "pendiente_pago") return failed(booking.id, { hint: "not_pending" });

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return {
      ok: false,
      error: "Falta configurar SUPABASE_SERVICE_ROLE_KEY para usar el pago simulado.",
    };
  }

  const { error } = await admin.rpc("confirm_booking_payment", {
    p_booking_id: booking.id,
    p_provider_payment_id: `simulado-${booking.id}`,
    p_amount: booking.price ?? 0,
    p_commission: 0,
  });
  if (error) return failed(booking.id, error);

  refresh(booking.id);
  return { ok: true };
}
