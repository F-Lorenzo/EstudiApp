import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { bookingErrorMessage } from "@/lib/bookings/errors";
import { holdExpiresAt } from "@/lib/bookings/hold";
import type { CardPaymentData } from "@/lib/validation/payment";
import { MercadoPagoError } from "./mercadopago/errors";
import { applyProviderPayment } from "./notifications";
import type { PaymentProvider, ProviderPayment } from "./provider";
import { SellerTokenError, type SellerToken } from "./seller-token";

/**
 * Cobro de una reserva pendiente con Checkout API (formulario de tarjeta dentro de EstudiApp). Dos pasos:
 *
 *  1. `prepareBookingPayment`: comprueba que la reserva se pueda pagar y devuelve la clave pública del docente
 *     y el monto, para que el navegador muestre el formulario de Mercado Pago y tokenice la tarjeta.
 *  2. `payBookingWithCard`: con el token de la tarjeta, crea el pago y se lo pasa a la base en el momento
 *     (`applyProviderPayment`, el mismo camino que el aviso). El aviso sigue llegando y es idempotente.
 *
 * Reglas:
 *
 *  - El precio y la tasa de comisión salen de la RESERVA en la base, nunca de lo que mande el navegador.
 *  - La comisión en pesos la calcula la base (`booking_commission`), la misma función con la que
 *    `confirm_booking_payment` valida el pago después. No se recalcula acá: la base es la fuente.
 *  - El pago se crea con el token del DOCENTE (modelo marketplace) y la tarjeta se tokeniza con SU clave
 *    pública. Se vuelve a comprobar la retención justo antes de cobrar; si igual el pago entra tarde, la base
 *    lo rechaza y se devuelve completo.
 *  - Nunca se muestran tokens ni detalles internos: los mensajes son para la persona, los detalles van al log
 *    (sin datos personales).
 *
 * Que el alumno sea el dueño de la reserva lo comprueba quien llama (la acción del servidor), y acá se vuelve a
 * comprobar contra la fila leída con permisos de sistema.
 */
export type CheckoutDeps = {
  /** Cliente con permisos de sistema (lee la reserva y calcula la comisión). */
  db: Pick<SupabaseClient, "from" | "rpc">;
  provider: PaymentProvider;
  loadSellerTokenByTutor: (tutorId: string) => Promise<SellerToken>;
  /** Dirección pública de la app, sin barra final (`siteUrl()`). */
  siteUrl: string;
  now?: () => Date;
  log?: (message: string, data?: Record<string, unknown>) => void;
};

export type CheckoutInput = {
  bookingId: string;
  /** El alumno que paga: tiene que ser el dueño de la reserva. */
  studentId: string;
  studentEmail?: string | null;
  tutorName: string;
};

export type CheckoutFailure =
  | "not_found"
  | "not_pending"
  | "hold_expired"
  | "class_started"
  | "invalid_price"
  | "tutor_not_payable"
  | "provider_unavailable"
  | "provider_rejected"
  | "card_rejected"
  | "unavailable";

/** `stale`: lo que la persona ve ya no es así (venció, se canceló): conviene volver a leer la pantalla. */
export type CheckoutFailureResult = { ok: false; code: CheckoutFailure; error: string; stale: boolean };

export type PrepareResult =
  | {
      ok: true;
      /** Clave pública de la cuenta de cobro del docente (para el formulario de tarjeta). */
      publicKey: string;
      amount: number;
      /** Para completar el email en el formulario; `null` en las cuentas demo. */
      payerEmail: string | null;
    }
  | CheckoutFailureResult;

export type PayResult =
  /**
   * `confirmed`: la reserva quedó confirmada. `processing`: el pago está aprobado o en proceso pero la base
   * todavía no confirmó (la pantalla se queda consultando). `refunded`: se cobró tarde y se devuelve completo.
   */
  | { ok: true; status: "confirmed" | "processing" | "refunded" }
  | CheckoutFailureResult;

// PostgREST entrega los `numeric` como número; otros clientes de Postgres, como texto. Se aceptan los dos.
const numeric = z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/).transform(Number)]);

const bookingRowSchema = z.object({
  id: z.string(),
  student_id: z.string(),
  tutor_id: z.string(),
  status: z.string(),
  price: numeric.nullable(),
  commission_rate: numeric,
  created_at: z.string(),
  starts_at: z.string(),
});

const MAX_TITLE_CHARS = 120;

const defaultLog = (message: string, data?: Record<string, unknown>) =>
  console.error(JSON.stringify({ source: "checkout", message, ...data }));

function fail(code: CheckoutFailure, error: string, stale = false): CheckoutFailureResult {
  return { ok: false, code, error, stale };
}

const UNAVAILABLE = "No pudimos iniciar el pago. Intentá de nuevo en unos minutos.";

type PayableBooking = { id: string; price: number; fee: number; seller: SellerToken };

/** Todo lo que tiene que ser cierto para cobrar una reserva, leído de la base en este momento. */
async function loadPayableBooking(
  deps: CheckoutDeps,
  input: CheckoutInput,
): Promise<{ ok: true; booking: PayableBooking } | CheckoutFailureResult> {
  const log = deps.log ?? defaultLog;
  const now = (deps.now ?? (() => new Date()))();

  // 1. La reserva, tal como está en la base.
  const { data, error } = await deps.db
    .from("bookings")
    .select("id, student_id, tutor_id, status, price, commission_rate, created_at, starts_at")
    .eq("id", input.bookingId)
    .maybeSingle();
  if (error) {
    log("no se pudo leer la reserva", { bookingId: input.bookingId });
    return fail("unavailable", UNAVAILABLE);
  }
  const parsed = bookingRowSchema.safeParse(data);
  if (!parsed.success || parsed.data.student_id !== input.studentId) {
    return fail("not_found", bookingErrorMessage({ hint: "not_found" }), true);
  }
  const booking = parsed.data;

  // 2. Solo se cobra una reserva pendiente, dentro de la retención del horario y antes de que empiece la clase.
  if (booking.status !== "pendiente_pago") return fail("not_pending", bookingErrorMessage({ hint: "not_pending" }), true);
  if (holdExpiresAt(booking.created_at).getTime() <= now.getTime()) return fail("hold_expired", bookingErrorMessage({ hint: "hold_expired" }), true);
  if (new Date(booking.starts_at).getTime() <= now.getTime()) return fail("class_started", bookingErrorMessage({ hint: "class_started" }), true);

  const price = booking.price;
  if (price == null || !Number.isFinite(price) || price <= 0) {
    return fail("invalid_price", "Esta reserva no tiene un precio válido. Escribinos y lo resolvemos.");
  }

  // 3. La comisión la calcula la base, con la tasa que la reserva guardó al crearse.
  const commission = await deps.db.rpc("booking_commission", { p_amount: price, p_rate: booking.commission_rate });
  const fee = numeric.safeParse(commission.data);
  if (commission.error || !fee.success || fee.data < 0 || fee.data >= price) {
    log("la comisión calculada no es válida", { bookingId: booking.id });
    return fail("unavailable", UNAVAILABLE);
  }

  // 4. El token del docente: sin cuenta de cobro vinculada (o vencida) no hay dónde cobrar.
  let seller: SellerToken;
  try {
    seller = await deps.loadSellerTokenByTutor(booking.tutor_id);
  } catch (cause) {
    if (cause instanceof SellerTokenError) {
      log("no se pudo obtener el token del docente", { bookingId: booking.id, reason: cause.reason });
      return cause.reason === "unknown_seller" || cause.reason === "expired"
        ? fail("tutor_not_payable", bookingErrorMessage({ hint: "tutor_not_payable" }))
        : fail("unavailable", UNAVAILABLE);
    }
    log("error inesperado al buscar el token del docente", { bookingId: booking.id });
    return fail("unavailable", UNAVAILABLE);
  }

  return { ok: true, booking: { id: booking.id, price, fee: fee.data, seller } };
}

// En las cuentas demo el correo de EstudiApp no es el de un comprador de Mercado Pago: no se sugiere.
function suggestedPayerEmail(email: string | null | undefined) {
  return email && !email.toLowerCase().endsWith("@estudiapp.test") ? email : null;
}

/** Paso 1: lo que necesita el navegador para mostrar el formulario de tarjeta. No cobra nada. */
export async function prepareBookingPayment(deps: CheckoutDeps, input: CheckoutInput): Promise<PrepareResult> {
  const result = await loadPayableBooking(deps, input);
  if (!result.ok) return result;
  const { booking } = result;
  // Sin clave pública (cuentas vinculadas antes de guardarla) el navegador no puede tokenizar la tarjeta.
  if (!booking.seller.publicKey) {
    (deps.log ?? defaultLog)("la cuenta de cobro del docente no tiene clave pública", { bookingId: booking.id });
    return fail("tutor_not_payable", bookingErrorMessage({ hint: "tutor_not_payable" }));
  }
  return { ok: true, publicKey: booking.seller.publicKey, amount: booking.price, payerEmail: suggestedPayerEmail(input.studentEmail) };
}

/**
 * Paso 2: cobra con el token de la tarjeta y le pasa el pago a la base en el momento. Repetirlo con el mismo
 * token es inocuo: la clave de idempotencia sale de la reserva y del token, así un doble clic no cobra dos veces.
 */
export async function payBookingWithCard(
  deps: CheckoutDeps,
  input: CheckoutInput & { card: CardPaymentData },
): Promise<PayResult> {
  const log = deps.log ?? defaultLog;
  const result = await loadPayableBooking(deps, input);
  if (!result.ok) return result;
  const { booking } = result;
  const { card } = input;

  let payment: ProviderPayment;
  try {
    payment = await deps.provider.createPayment(
      { accessToken: booking.seller.accessToken },
      {
        bookingId: booking.id,
        description: `Clase individual con ${input.tutorName}`.slice(0, MAX_TITLE_CHARS),
        amount: booking.price,
        applicationFee: booking.fee,
        notificationUrl: `${deps.siteUrl.replace(/\/+$/, "")}/api/mercadopago/webhook`,
        cardToken: card.token,
        paymentMethodId: card.payment_method_id,
        issuerId: card.issuer_id ?? null,
        installments: card.installments,
        payer: { email: card.payer.email, identification: card.payer.identification ?? null },
        idempotencyKey: `reserva-${booking.id}-${createHash("sha256").update(card.token).digest("hex").slice(0, 32)}`,
      },
    );
  } catch (cause) {
    if (!(cause instanceof MercadoPagoError)) {
      log("error inesperado al crear el pago", { bookingId: booking.id });
      return fail("unavailable", UNAVAILABLE);
    }
    // `cause` y `detail` dicen POR QUÉ lo rechazó (p. ej. `2034`, «Invalid users involved»). El mensaje de Mercado
    // Pago no lleva tokens ni datos de la tarjeta.
    log("Mercado Pago no creó el pago", {
      bookingId: booking.id,
      kind: cause.kind,
      status: cause.status,
      code: cause.code,
      cause: cause.causeCode,
      detail: cause.message,
      retryable: cause.retryable,
    });
    if (cause.retryable) {
      return fail("provider_unavailable", "Mercado Pago no está respondiendo en este momento. Probá de nuevo en unos minutos.");
    }
    // Un token rechazado (401/403) es de la cuenta del docente: el alumno no puede arreglarlo.
    if (cause.status === 401 || cause.status === 403) {
      return fail("tutor_not_payable", bookingErrorMessage({ hint: "tutor_not_payable" }));
    }
    // El email del pagador lo escribe la persona en el formulario: si Mercado Pago no lo acepta, se le dice eso.
    if (cause.causeCode === "4050" || cause.causeCode === "2034") {
      return fail("provider_rejected", "Mercado Pago no aceptó el email del pagador. Revisalo, o probá con otro, e intentá de nuevo.");
    }
    return fail("provider_rejected", "No pudimos procesar la tarjeta. Revisá los datos e intentá de nuevo.");
  }

  if (payment.status === "rejected" || payment.status === "cancelled") {
    return fail("card_rejected", rejectionMessage(payment.statusDetail));
  }

  // El pago existe: la base decide qué hacer con él (confirmar, o devolverlo si llegó tarde).
  const applied = await applyProviderPayment({ db: deps.db, provider: deps.provider }, payment, booking.seller);
  if (applied.kind === "done") {
    if (applied.outcome === "confirmada" || applied.outcome === "ya_confirmada") return { ok: true, status: "confirmed" };
    if (applied.outcome === "reembolso_encolado" || applied.outcome === "reembolso_existente") return { ok: true, status: "refunded" };
  } else {
    log("el pago se creó pero no se pudo aplicar en el momento", { bookingId: booking.id, kind: applied.kind, reason: applied.reason });
  }
  // Aprobado pero sin confirmar todavía (o en proceso): el aviso y la reconciliación lo terminan.
  return { ok: true, status: "processing" };
}

/** Qué decirle a la persona según el motivo del rechazo de Mercado Pago (`status_detail`). */
export function rejectionMessage(statusDetail: string | null): string {
  switch (statusDetail) {
    case "cc_rejected_insufficient_amount":
      return "La tarjeta no tiene fondos suficientes. Probá con otra.";
    case "cc_rejected_bad_filled_security_code":
      return "El código de seguridad no es correcto. Revisalo e intentá de nuevo.";
    case "cc_rejected_bad_filled_date":
      return "La fecha de vencimiento no es correcta. Revisala e intentá de nuevo.";
    case "cc_rejected_bad_filled_card_number":
    case "cc_rejected_bad_filled_other":
      return "Algún dato de la tarjeta no es correcto. Revisalos e intentá de nuevo.";
    case "cc_rejected_call_for_authorize":
      return "Tu banco necesita que autorices el pago. Llamalo y volvé a intentar, o probá con otra tarjeta.";
    case "cc_rejected_card_disabled":
      return "La tarjeta no está habilitada. Llamá a tu banco para activarla o probá con otra.";
    case "cc_rejected_duplicated_payment":
      return "Ya hiciste un pago por este mismo monto. Si necesitás pagar de nuevo, usá otra tarjeta.";
    case "cc_rejected_max_attempts":
      return "Llegaste al límite de intentos con esta tarjeta. Probá con otra.";
    default:
      return "El pago fue rechazado. Probá con otra tarjeta o medio de pago.";
  }
}
