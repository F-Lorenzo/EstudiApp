import { z } from "zod";
import { MercadoPagoError } from "./mercadopago/errors";
import { applyProviderPayment } from "./notifications";
import type { PaymentProvider } from "./provider";
import type { PaymentsRpc } from "./refunds";
import { SellerTokenError, type SellerToken } from "./seller-token";

/**
 * Reconciliación: cuando el alumno vuelve del checkout y la reserva sigue pendiente, se le pregunta a Mercado Pago
 * qué pagos tiene esa reserva (por `external_reference`) y cada pago aprobado pasa por el MISMO camino que un
 * aviso (`applyProviderPayment`). Así un aviso perdido, tardío o rechazado por un error nuestro no deja al alumno
 * colgado con la plata ya cobrada.
 *
 * Seguridad y costo:
 *  - Es idempotente: la base decide (`apply_payment_notification`) y repetir un pago ya procesado no hace nada.
 *  - Solo se consideran pagos de ESTA reserva (referencia exacta) y aprobados; el resto no cambia nada.
 *  - Nunca lanza: si Mercado Pago o la base fallan, devuelve el problema y la pantalla sigue funcionando (el aviso
 *    normal sigue en pie).
 *  - Es barata: una sola consulta de búsqueda y, como mucho, unos pocos pagos. `createReconcileThrottle` evita que
 *    una pestaña (o un script) dispare consultas seguidas de la misma reserva.
 */
export type ReconcileDeps = {
  db: PaymentsRpc;
  provider: PaymentProvider;
  loadSellerTokenByTutor: (tutorId: string) => Promise<SellerToken>;
};

export type ReconcileReport = {
  /** ¿Se llegó a consultar a Mercado Pago? */
  checked: boolean;
  /** Pagos aprobados de la reserva que se le pasaron a la base. */
  processed: number;
  /** Lo que respondió la base por cada uno (`confirmada`, `ya_confirmada`, `reembolso_encolado`...). */
  outcomes: string[];
  /** Un problema pasajero o algo para revisar. Es para el log: nunca se le muestra a la persona. */
  problem: string | null;
};

/** Una reserva tiene uno o dos pagos como mucho; el tope evita procesar una respuesta desmedida. */
const MAX_PAYMENTS = 5;

export async function reconcileBookingPayments(
  { db, provider, loadSellerTokenByTutor }: ReconcileDeps,
  { bookingId, tutorId }: { bookingId: string; tutorId: string },
): Promise<ReconcileReport> {
  // Sin una referencia válida no se busca nada: la búsqueda es por la reserva, no por texto libre.
  if (!z.uuid().safeParse(bookingId).success) return { checked: false, processed: 0, outcomes: [], problem: "reserva_invalida" };

  let seller: SellerToken;
  try {
    seller = await loadSellerTokenByTutor(tutorId);
  } catch (error) {
    if (!(error instanceof SellerTokenError)) return { checked: false, processed: 0, outcomes: [], problem: "token_inesperado" };
    return { checked: false, processed: 0, outcomes: [], problem: `token_${error.reason}` };
  }

  let payments;
  try {
    payments = await provider.searchPaymentsByReference({ accessToken: seller.accessToken }, bookingId);
  } catch (error) {
    const detail = error instanceof MercadoPagoError ? error.message : "error inesperado";
    return { checked: false, processed: 0, outcomes: [], problem: `consulta: ${detail}`.slice(0, 300) };
  }

  const approved = payments.filter((payment) => payment.externalReference === bookingId && payment.status === "approved").slice(0, MAX_PAYMENTS);

  const outcomes: string[] = [];
  let problem: string | null = null;
  for (const payment of approved) {
    try {
      const result = await applyProviderPayment({ db, provider }, payment, seller);
      if (result.kind === "done") outcomes.push(result.outcome);
      else {
        // Falla pasajera o algo para revisar: se anota y se sigue con los demás pagos.
        outcomes.push(result.kind);
        problem ??= result.reason.slice(0, 300);
      }
    } catch {
      outcomes.push("error");
      problem ??= "error inesperado al procesar el pago";
    }
  }
  return { checked: true, processed: approved.length, outcomes, problem };
}

/**
 * Límite de frecuencia por reserva, en memoria de este servidor: como mucho una consulta cada `minIntervalMs` y
 * nunca dos al mismo tiempo. No reemplaza a la idempotencia de la base (que es la que protege el dinero): solo evita
 * gastar llamadas a Mercado Pago. Con varias instancias del servidor el límite es por instancia; alcanza para
 * que una pestaña que refresca cada pocos segundos no multiplique las consultas.
 */
export function createReconcileThrottle({
  minIntervalMs = 5_000,
  maxEntries = 1_000,
  now = () => Date.now(),
}: { minIntervalMs?: number; maxEntries?: number; now?: () => number } = {}) {
  const lastRun = new Map<string, number>();
  const running = new Set<string>();

  return {
    /** `true` si corresponde consultar ahora (y deja la reserva marcada como en curso). Hay que llamar a `release`. */
    acquire(bookingId: string): boolean {
      if (running.has(bookingId)) return false;
      const current = now();
      const last = lastRun.get(bookingId);
      if (last !== undefined && current - last < minIntervalMs) return false;
      if (lastRun.size >= maxEntries) {
        // Las marcas viejas ya no limitan nada: se descartan para que el mapa no crezca sin tope.
        for (const [key, at] of lastRun) if (current - at >= minIntervalMs) lastRun.delete(key);
        if (lastRun.size >= maxEntries) return false;
      }
      lastRun.set(bookingId, current);
      running.add(bookingId);
      return true;
    },
    release(bookingId: string) {
      running.delete(bookingId);
    },
  };
}
