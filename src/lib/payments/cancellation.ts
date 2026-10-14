import { z } from "zod";
import type { PaymentProvider } from "./provider";
import { executeRefund, isSimulatedPaymentId, refundRowSchema, type PaymentsRpc, type RefundRow } from "./refunds";
import type { SellerToken } from "./seller-token";

/**
 * Lo que sigue a `cancel_booking` (migración 0013). La base ya canceló la reserva y, si había un pago aprobado
 * y corresponde devolver algo, dejó el reembolso en la cola (`refunds`). Acá se lee ese resultado y se ejecuta
 * el reembolso. La regla del dinero (cuánto se devuelve) es de la base: este archivo solo la lee y la orquesta.
 *
 * Principio: LA CANCELACIÓN NUNCA SE DESHACE por un problema con el reembolso. Si Mercado Pago no responde, el
 * reembolso queda pendiente o fallido en la cola y el barrido (`refund-sweep.ts`) lo reintenta.
 */

export const cancelResultSchema = z.object({
  paid: z.boolean(),
  percent: z.number(),
  amount: z.number(),
  refund: refundRowSchema.nullish(),
  cancelled_by: z.enum(["alumno", "docente", "administracion"]),
});

export type CancelResult = {
  /** La reserva tenía un pago aprobado. */
  paid: boolean;
  /** Porcentaje que corresponde devolver, según la base. */
  percent: number;
  amount: number;
  cancelledBy: "alumno" | "docente" | "administracion";
  /** La fila de la cola de reembolsos, si hay algo para devolver. */
  refund: RefundRow | null;
};

/** `null` si lo que devolvió la base no tiene la forma del contrato (por ejemplo, una versión anterior de la función). */
export function parseCancelResult(data: unknown): CancelResult | null {
  const parsed = cancelResultSchema.safeParse(data);
  if (!parsed.success) return null;
  const { paid, percent, amount, refund, cancelled_by } = parsed.data;
  return { paid, percent, amount, cancelledBy: cancelled_by, refund: refund ?? null };
}

/** Cómo quedó el reembolso al terminar la cancelación (lo que se le cuenta a la persona). */
export type RefundOutcome = "aprobado" | "pendiente" | "fallido";

export type CancelRefundReport = { percent: number; amount: number; status: RefundOutcome };

export type SettleDeps = {
  db: PaymentsRpc;
  provider: PaymentProvider;
  /** Token de la cuenta de cobro que recibió el pago (por su id de Mercado Pago). */
  loadSellerToken: (mpUserId: string) => Promise<SellerToken>;
  log?: (message: string, data?: Record<string, unknown>) => void;
};

const defaultLog = (message: string, data?: Record<string, unknown>) =>
  console.error(JSON.stringify({ source: "cancel-refund", message, ...data }));

/**
 * Ejecuta el reembolso que dejó `cancel_booking`. Nunca lanza: devuelve cómo quedó.
 *
 *  - `aprobado`: ya se devolvió (o era un pago simulado, que no mueve plata).
 *  - `fallido`: Mercado Pago lo rechazó o no respondió; queda en la cola y el barrido lo reintenta.
 *  - `pendiente`: ni se intentó (falta la cuenta de cobro, el token venció o falta configuración); el barrido lo retoma.
 */
export async function settleCancellationRefund(deps: SettleDeps, refund: RefundRow): Promise<RefundOutcome> {
  const log = deps.log ?? defaultLog;
  if (refund.status === "aprobado") return "aprobado";

  try {
    let accessToken: string | null = null;
    if (!isSimulatedPaymentId(refund.mercadopago_payment_id)) {
      if (!refund.mp_user_id) {
        log("el reembolso no tiene cuenta de cobro: queda para el barrido", { refundId: refund.id });
        return "pendiente";
      }
      try {
        accessToken = (await deps.loadSellerToken(refund.mp_user_id)).accessToken;
      } catch (error) {
        // El token puede estar vencido o ilegible: se renueva y el barrido lo reintenta. No se muestra ningún dato.
        log("no se pudo obtener el token para reembolsar", { refundId: refund.id, reason: errorLabel(error) });
        return "pendiente";
      }
    }

    const execution = await executeRefund({ db: deps.db, provider: deps.provider, accessToken }, refund);
    if (execution.status === "aprobado") return "aprobado";
    log("el reembolso no se pudo completar ahora", { refundId: refund.id, retryable: execution.retryable, detail: execution.detail });
    return "fallido";
  } catch (error) {
    log("falló la ejecución del reembolso", { refundId: refund.id, reason: errorLabel(error) });
    return "fallido";
  }
}

/** Nombre del error sin su mensaje (los mensajes pueden venir de afuera). */
function errorLabel(error: unknown) {
  if (error instanceof Error) {
    const reason = (error as { reason?: unknown }).reason;
    return typeof reason === "string" ? `${error.name}:${reason}` : error.name;
  }
  return "desconocido";
}

/** Resumen de la cancelación para la pantalla: qué porcentaje y monto corresponden y cómo quedó el reembolso. */
export function cancelRefundReport(result: CancelResult, outcome: RefundOutcome | null): CancelRefundReport | null {
  if (!result.refund || outcome === null) return null;
  return { percent: result.percent, amount: result.amount, status: outcome };
}

/**
 * Todo lo que sigue a un `cancel_booking` exitoso, para las acciones del alumno y del docente: lee el resultado
 * y, si dejó un reembolso en la cola, lo ejecuta. `createDeps` arma el cliente de base, el proveedor y la búsqueda
 * de tokens; si lanza (falta la clave de servicio, por ejemplo) el reembolso queda pendiente para el barrido.
 * Nunca lanza.
 */
export async function settleCancelledBooking(
  data: unknown,
  createDeps: () => SettleDeps,
  log: NonNullable<SettleDeps["log"]> = defaultLog,
): Promise<{ result: CancelResult | null; refund: CancelRefundReport | null }> {
  const result = parseCancelResult(data);
  if (!result) {
    log("cancel_booking devolvió algo que no se entiende: no se ejecuta ningún reembolso");
    return { result: null, refund: null };
  }
  if (!result.refund) return { result, refund: null };

  let outcome: RefundOutcome = "pendiente";
  try {
    outcome = await settleCancellationRefund({ log, ...createDeps() }, result.refund);
  } catch (error) {
    log("no se pudo armar el cliente de reembolsos: queda para el barrido", { refundId: result.refund.id, reason: errorLabel(error) });
  }
  return { result, refund: cancelRefundReport(result, outcome) };
}
