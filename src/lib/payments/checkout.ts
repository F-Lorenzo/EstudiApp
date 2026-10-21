import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { bookingErrorMessage } from "@/lib/bookings/errors";
import { holdExpiresAt } from "@/lib/bookings/hold";
import { MercadoPagoError } from "./mercadopago/errors";
import type { PaymentProvider } from "./provider";
import { SellerTokenError, type SellerToken } from "./seller-token";

/**
 * Crea el link de pago de Mercado Pago para una reserva pendiente. Reglas:
 *
 *  - El precio y la tasa de comisión salen de la RESERVA en la base, nunca de lo que mande el navegador.
 *  - La comisión en pesos la calcula la base (`booking_commission`), la misma función con la que
 *    `confirm_booking_payment` valida el pago después. No se recalcula acá: la base es la fuente.
 *  - La preferencia se crea con el token del DOCENTE (modelo marketplace) y vence cuando termina la
 *    retención del horario: un link vencido no cobra.
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
  /** Fuerza el link de pruebas de Mercado Pago. Nunca hace fallback a producción. */
  useSandboxCheckout?: boolean;
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
  | "unavailable";

export type CheckoutResult =
  | { ok: true; url: string }
  /** `stale`: lo que la persona ve ya no es así (venció, se canceló): conviene volver a leer la pantalla. */
  | { ok: false; code: CheckoutFailure; error: string; stale: boolean };

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

function fail(code: CheckoutFailure, error: string, stale = false): CheckoutResult {
  return { ok: false, code, error, stale };
}

const UNAVAILABLE = "No pudimos iniciar el pago. Intentá de nuevo en unos minutos.";

export async function createBookingCheckout(deps: CheckoutDeps, input: CheckoutInput): Promise<CheckoutResult> {
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
  const expiresAt = holdExpiresAt(booking.created_at);
  if (expiresAt.getTime() <= now.getTime()) return fail("hold_expired", bookingErrorMessage({ hint: "hold_expired" }), true);
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

  // 5. La preferencia de pago.
  const base = deps.siteUrl.replace(/\/+$/, "");
  const back = (outcome: "ok" | "pendiente" | "fallido") => `${base}/alumno/reservas/${booking.id}?pago=${outcome}`;
  // En las cuentas demo el correo de EstudiApp no es el correo del comprador de Mercado Pago.
  // Omitirlo permite que Checkout Pro use el comprador de prueba autenticado, sin forzar un
  // correo ficticio que Mercado Pago puede rechazar por no coincidir con esa cuenta.
  const payerEmail = input.studentEmail?.toLowerCase().endsWith("@estudiapp.test") ? undefined : input.studentEmail;
  try {
    const checkout = await deps.provider.createCheckout(
      { accessToken: seller.accessToken },
      {
        bookingId: booking.id,
        title: `Clase individual con ${input.tutorName}`.slice(0, MAX_TITLE_CHARS),
        amount: price,
        marketplaceFee: fee.data,
        notificationUrl: `${base}/api/mercadopago/webhook`,
        backUrls: { success: back("ok"), pending: back("pendiente"), failure: back("fallido") },
        // El link deja de cobrar cuando el horario deja de estar retenido.
        expiresAt,
        ...(payerEmail ? { payerEmail } : {}),
      },
    );
    // Una cuenta autorizada en sandbox devuelve `live_mode=false` y dos links. El interruptor de
    // runtime también permite forzar pruebas cuando Mercado Pago marca erróneamente el token OAuth
    // como live. En ese caso NO se admite fallback a `init_point`: una prueba nunca debe abrir
    // checkout de producción.
    const useSandboxCheckout = deps.useSandboxCheckout === true || seller.liveMode === false;
    const checkoutLink = useSandboxCheckout ? checkout.sandboxCheckoutUrl : checkout.checkoutUrl;
    const url = checkoutLink ? safeCheckoutUrl(checkoutLink) : null;
    if (!url) {
      log("Mercado Pago no devolvió un link de pago utilizable", { bookingId: booking.id, sandbox: useSandboxCheckout });
      return useSandboxCheckout
        ? fail("provider_rejected", "Mercado Pago no devolvió un checkout de prueba. Revisá las credenciales de prueba e intentá de nuevo.")
        : fail("unavailable", UNAVAILABLE);
    }
    return { ok: true, url };
  } catch (cause) {
    if (!(cause instanceof MercadoPagoError)) {
      log("error inesperado al crear el pago", { bookingId: booking.id });
      return fail("unavailable", UNAVAILABLE);
    }
    log("Mercado Pago no creó el pago", { bookingId: booking.id, kind: cause.kind, status: cause.status, retryable: cause.retryable });
    if (cause.retryable) {
      return fail("provider_unavailable", "Mercado Pago no está respondiendo en este momento. Probá de nuevo en unos minutos.");
    }
    // Un token rechazado (401/403) es de la cuenta del docente: el alumno no puede arreglarlo.
    if (cause.status === 401 || cause.status === 403) {
      return fail("tutor_not_payable", bookingErrorMessage({ hint: "tutor_not_payable" }));
    }
    return fail("provider_rejected", "No pudimos crear el pago. Probá de nuevo y, si sigue pasando, escribinos.");
  }
}

/** Solo se manda al navegador un link https. */
function safeCheckoutUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
