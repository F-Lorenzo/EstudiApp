"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getViewer } from "@/lib/auth/viewer";
import { bookingErrorMessage, isStaleStateError } from "@/lib/bookings/errors";
import { getStudentBooking } from "@/lib/bookings/queries";
import { refundExplanation, refundPercent } from "@/lib/bookings/refund-policy";
import { paymentSimulationEnabled } from "@/lib/bookings/simulation";
import { scheduleEmailDelivery } from "@/lib/email/schedule";
import { settleCancelledBooking, type CancelRefundReport } from "@/lib/payments/cancellation";
import { createBookingCheckout } from "@/lib/payments/checkout";
import { paymentsConfigured } from "@/lib/payments/config";
import { createReconcileThrottle, reconcileBookingPayments } from "@/lib/payments/reconcile";
import { SIMULATED_PAYMENT_PREFIX } from "@/lib/payments/refunds";
import { createPaymentServices } from "@/lib/payments/runtime";
import { siteUrl } from "@/lib/payments/site-url";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type BookingActionResult = { ok: true } | { ok: false; error: string };

export type CheckoutActionResult = { ok: true; url: string } | { ok: false; error: string };

export type ReconcileActionResult =
  | {
      ok: true;
      /** ¿Se llegó a consultar a Mercado Pago en esta llamada? (puede no haberse hecho: límite de frecuencia, nada para consultar). */
      checked: boolean;
    }
  | { ok: false; error: string };

export type CancelBookingResult =
  | {
      ok: true;
      /** Reembolso de la cancelación (y cómo quedó), o `null` si no hubo pago o no corresponde devolver nada. */
      refund: CancelRefundReport | null;
    }
  | { ok: false; error: string };

const PAYMENTS_UNAVAILABLE = "El pago con Mercado Pago todavía no está disponible.";

// Límite de frecuencia de la reconciliación por reserva (en memoria de este servidor, ver `reconcile.ts`).
const reconcileThrottle = createReconcileThrottle({ minIntervalMs: 5_000 });

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

const log = (message: string, data?: Record<string, unknown>) =>
  console.error(JSON.stringify({ source: "student-booking", message, ...data }));

/**
 * Cancela una reserva del alumno (la función de la base valida las reglas y decide cuánto se devuelve).
 *
 * Si la reserva estaba paga y corresponde un reembolso, la base lo deja en la cola y acá se ejecuta contra
 * Mercado Pago con el token de la cuenta que cobró. LA CANCELACIÓN NO SE DESHACE si el reembolso falla: queda
 * pendiente y el barrido lo reintenta; al alumno se le dice que lo estamos procesando.
 *
 * `expectedRefundPercent` es el porcentaje que la pantalla le mostró a la persona antes de confirmar. Si mientras
 * decidía pasó el límite de 24 h o de 2 h y ahora corresponde menos, NO se cancela: se le muestra el nuevo
 * porcentaje para que confirme de nuevo. (La base sigue siendo la que decide el monto real.)
 */
export async function cancelBooking(bookingId: string, expectedRefundPercent?: number): Promise<CancelBookingResult> {
  const parsed = z.uuid().safeParse(bookingId);
  if (!parsed.success) {
    return { ok: false, error: bookingErrorMessage({ hint: "not_found" }) };
  }

  const supabase = await createClient();

  if (typeof expectedRefundPercent === "number") {
    const viewer = await getViewer();
    if (!viewer) return { ok: false, error: bookingErrorMessage({ hint: "not_authenticated" }) };
    let booking;
    try {
      booking = await getStudentBooking(supabase, parsed.data, viewer.id);
    } catch {
      return { ok: false, error: bookingErrorMessage(null) };
    }
    if (!booking) return failed(parsed.data, { hint: "not_found" });
    if (booking.paid) {
      const actual = refundPercent({ startsAt: booking.startsAt, at: new Date() });
      if (actual < expectedRefundPercent) {
        return {
          ok: false,
          error: `Mientras decidías pasó el plazo y cambió el reembolso. ${refundExplanation(actual, booking.price)} Si querés cancelar igual, confirmalo de nuevo.`,
        };
      }
    }
  }

  const { data, error } = await supabase.rpc("cancel_booking", {
    p_booking_id: parsed.data,
    p_reason: null,
  });
  if (error) return failed(parsed.data, error);

  // Desde acá la reserva YA está cancelada: nada de lo que pase con el reembolso la deshace.
  const { refund } = await settleCancelledBooking(data, () => {
    const services = createPaymentServices({ timeoutMs: 8_000, maxAttempts: 2 });
    return { db: services.admin, provider: services.provider, loadSellerToken: services.loadSellerToken };
  });

  refresh(parsed.data);
  // Los emails de la cancelación y del reembolso los dejó anotados la base: acá se pide enviarlos.
  scheduleEmailDelivery();
  return { ok: true, refund };
}

/**
 * Crea el pago en Mercado Pago y devuelve el link adonde mandar al alumno. Solo para el alumno dueño de una
 * reserva pendiente, dentro de los 15 minutos de retención. El precio y la comisión salen de la base.
 */
export async function startCheckout(bookingId: string): Promise<CheckoutActionResult> {
  const parsed = z.uuid().safeParse(bookingId);
  if (!parsed.success) return { ok: false, error: bookingErrorMessage({ hint: "not_found" }) };

  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: bookingErrorMessage({ hint: "not_authenticated" }) };
  if (viewer.role !== "alumno") return { ok: false, error: bookingErrorMessage({ hint: "not_student" }) };
  if (!paymentsConfigured()) return { ok: false, error: PAYMENTS_UNAVAILABLE };

  const supabase = await createClient();
  let booking;
  try {
    booking = await getStudentBooking(supabase, parsed.data, viewer.id);
  } catch {
    return { ok: false, error: bookingErrorMessage(null) };
  }
  if (!booking) return failed(parsed.data, { hint: "not_found" });
  if (booking.status !== "pendiente_pago") return failed(booking.id, { hint: "not_pending" });

  let services;
  let site;
  try {
    services = createPaymentServices({ timeoutMs: 6_000, maxAttempts: 2 });
    site = siteUrl();
  } catch {
    log("el cobro no está bien configurado", { bookingId: booking.id });
    return { ok: false, error: PAYMENTS_UNAVAILABLE };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const result = await createBookingCheckout(
    { db: services.admin, provider: services.provider, loadSellerTokenByTutor: services.loadSellerTokenByTutor, siteUrl: site },
    { bookingId: booking.id, studentId: viewer.id, studentEmail: user?.email ?? null, tutorName: booking.tutorName },
  );
  if (!result.ok) {
    if (result.stale) refresh(booking.id);
    return { ok: false, error: result.error };
  }
  return { ok: true, url: result.url };
}

/**
 * Pregunta a Mercado Pago por los pagos de una reserva que sigue pendiente y los procesa como si fueran avisos.
 * La usa la pantalla de «Estamos confirmando tu pago»: un aviso perdido o tardío no deja al alumno colgado.
 *
 * Es barata y segura: solo el dueño de la reserva, solo si está pendiente, una consulta cada pocos segundos por
 * reserva, y si Mercado Pago falla no pasa nada (el aviso normal sigue en pie). La base decide siempre.
 */
export async function reconcileBooking(bookingId: string): Promise<ReconcileActionResult> {
  const parsed = z.uuid().safeParse(bookingId);
  if (!parsed.success) return { ok: false, error: bookingErrorMessage({ hint: "not_found" }) };

  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: bookingErrorMessage({ hint: "not_authenticated" }) };

  const supabase = await createClient();
  let booking;
  try {
    booking = await getStudentBooking(supabase, parsed.data, viewer.id);
  } catch {
    return { ok: false, error: bookingErrorMessage(null) };
  }
  if (!booking) return failed(parsed.data, { hint: "not_found" });

  if (booking.status !== "pendiente_pago") {
    // Ya cambió (el aviso llegó, venció o se canceló): se vuelve a leer la pantalla y no hay nada que consultar.
    refresh(booking.id);
    return { ok: true, checked: false };
  }
  if (!paymentsConfigured() || !reconcileThrottle.acquire(booking.id)) return { ok: true, checked: false };

  try {
    const services = createPaymentServices({ timeoutMs: 5_000, maxAttempts: 1 });
    const report = await reconcileBookingPayments(
      { db: services.admin, provider: services.provider, loadSellerTokenByTutor: services.loadSellerTokenByTutor },
      { bookingId: booking.id, tutorId: booking.tutorId },
    );
    if (report.problem) log("la reconciliación encontró un problema", { bookingId: booking.id, problem: report.problem });
    if (report.processed > 0) {
      refresh(booking.id);
      scheduleEmailDelivery();
    }
    return { ok: true, checked: report.checked };
  } catch {
    log("la reconciliación falló", { bookingId: booking.id });
    return { ok: true, checked: false };
  } finally {
    reconcileThrottle.release(booking.id);
  }
}

/**
 * Confirma el pago sin cobrar. Solo existe para probar el recorrido en una máquina de
 * desarrollo, sin Mercado Pago, y únicamente si se habilitó a propósito (ver
 * `paymentSimulationEnabled`: nunca en Vercel). Comprueba que la reserva sea del alumno
 * y siga pendiente; la confirmación en sí la hace la función `confirm_booking_payment`,
 * que solo ejecuta la service role.
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
    // El prefijo marca el pago como simulado: reembolsarlo no llama a ningún proveedor (ver `refunds.ts`).
    p_provider_payment_id: `${SIMULATED_PAYMENT_PREFIX}${booking.id}`,
    p_amount: booking.price ?? 0,
    // Sin `p_commission`: la base usa la comisión que la reserva guardó al crearse (migración 0011).
  });
  if (error) return failed(booking.id, error);

  refresh(booking.id);
  scheduleEmailDelivery();
  return { ok: true };
}
