import { MercadoPagoError } from "./mercadopago/errors";
import type {
  AccessContext,
  CreateCheckoutInput,
  PaymentProvider,
  ProviderCheckout,
  ProviderPayment,
  ProviderRefund,
  RefundInput,
} from "./provider";

// Los identificadores de reembolso son únicos en todo Mercado Pago, no por cuenta ni por instancia.
let refundSequence = 0;

type Operation = "getPayment" | "searchPaymentsByReference" | "createCheckout" | "refundPayment";

/**
 * Proveedor de cobro simulado, en memoria. Se comporta como Mercado Pago en lo que importa para
 * probar el recorrido sin plata ni red:
 *
 *  - un pago solo lo ve el token de la cuenta que cobró (con otro token, «no existe»); la búsqueda por
 *    referencia devuelve solo los pagos de esa cuenta;
 *  - reembolsar con la misma clave de idempotencia devuelve lo mismo y NO devuelve dos veces;
 *  - no se puede devolver más de lo que se cobró;
 *  - se pueden programar fallas (`failNext`) para probar reintentos.
 *
 * No prueba nada del comportamiento REAL de Mercado Pago: eso se verifica en la cuenta de prueba.
 */
export class SimulatedPaymentProvider implements PaymentProvider {
  readonly payments = new Map<string, ProviderPayment>();
  readonly calls: { operation: Operation; accessToken: string; detail: unknown }[] = [];
  /** Reembolsos efectivamente hechos (una fila por clave de idempotencia distinta). */
  readonly refunds: (ProviderRefund & { paymentId: string; idempotencyKey: string })[] = [];

  private readonly sellers = new Map<string, string>();
  private readonly failures: { operation: Operation; error: Error }[] = [];

  /** Declara que ese token pertenece a la cuenta de cobro `collectorId`. */
  registerSeller(accessToken: string, collectorId: string) {
    this.sellers.set(accessToken, collectorId);
    return this;
  }

  addPayment(payment: Partial<ProviderPayment> & { id: string }) {
    const complete: ProviderPayment = {
      status: "approved",
      statusDetail: "accredited",
      amount: 10000,
      currency: "ARS",
      externalReference: null,
      collectorId: null,
      refundedAmount: 0,
      ...payment,
    };
    this.payments.set(complete.id, complete);
    return complete;
  }

  /** La próxima llamada de esa operación falla con ese error. */
  failNext(operation: Operation, error: Error = new MercadoPagoError("Falla simulada.", { kind: "http", status: 503, retryable: true })) {
    this.failures.push({ operation, error });
    return this;
  }

  private record(operation: Operation, ctx: AccessContext, detail: unknown) {
    this.calls.push({ operation, accessToken: ctx.accessToken, detail });
    const index = this.failures.findIndex((failure) => failure.operation === operation);
    if (index !== -1) throw this.failures.splice(index, 1)[0].error;
  }

  private visiblePayment(ctx: AccessContext, paymentId: string) {
    const payment = this.payments.get(paymentId);
    const seller = this.sellers.get(ctx.accessToken);
    if (!payment || (seller !== undefined && payment.collectorId !== seller)) {
      throw new MercadoPagoError("Mercado Pago respondió 404 (not_found): payment not found", {
        kind: "http",
        status: 404,
        retryable: false,
        code: "not_found",
      });
    }
    return payment;
  }

  async getPayment(ctx: AccessContext, paymentId: string): Promise<ProviderPayment> {
    this.record("getPayment", ctx, { paymentId });
    return { ...this.visiblePayment(ctx, paymentId) };
  }

  async searchPaymentsByReference(ctx: AccessContext, externalReference: string): Promise<ProviderPayment[]> {
    this.record("searchPaymentsByReference", ctx, { externalReference });
    const seller = this.sellers.get(ctx.accessToken);
    return [...this.payments.values()]
      .filter((payment) => payment.externalReference === externalReference && (seller === undefined || payment.collectorId === seller))
      .map((payment) => ({ ...payment }));
  }

  async createCheckout(ctx: AccessContext, input: CreateCheckoutInput): Promise<ProviderCheckout> {
    this.record("createCheckout", ctx, input);
    const id = `sim-pref-${input.bookingId}`;
    return {
      id,
      checkoutUrl: `https://simulado.example/checkout/${id}`,
      sandboxCheckoutUrl: `https://simulado.example/sandbox/${id}`,
    };
  }

  async refundPayment(ctx: AccessContext, input: RefundInput): Promise<ProviderRefund> {
    this.record("refundPayment", ctx, input);
    const payment = this.visiblePayment(ctx, input.paymentId);

    const previous = this.refunds.find((refund) => refund.idempotencyKey === input.idempotencyKey);
    if (previous) return { id: previous.id, status: previous.status, amount: previous.amount };

    const remaining = payment.amount - payment.refundedAmount;
    const amount = input.amount ?? remaining;
    if (amount <= 0 || amount > remaining + 1e-9) {
      throw new MercadoPagoError("Mercado Pago respondió 400 (bad_request): el monto a devolver supera lo disponible", {
        kind: "http",
        status: 400,
        retryable: false,
        code: "bad_request",
      });
    }

    payment.refundedAmount = Math.round((payment.refundedAmount + amount) * 100) / 100;
    if (payment.refundedAmount >= payment.amount) payment.status = "refunded";
    const refund = { id: `sim-refund-${++refundSequence}`, status: "approved", amount, paymentId: payment.id, idempotencyKey: input.idempotencyKey };
    this.refunds.push(refund);
    return { id: refund.id, status: refund.status, amount };
  }
}
