/**
 * Contrato con el proveedor de cobro. Lo implementan el cliente real de Mercado Pago
 * (`mercadopago/client.ts`) y uno simulado en memoria (`simulated-provider.ts`) para probar el
 * recorrido completo sin tocar plata ni la red.
 *
 * Todo lo que mueve dinero se hace con el token de la cuenta de cobro del DOCENTE (modelo
 * marketplace): por eso cada operación recibe el `accessToken` con el que se ejecuta.
 */

export type AccessContext = { accessToken: string };

/** Estados de un pago en Mercado Pago. Se aceptan otros por si agregan alguno. */
export type ProviderPaymentStatus =
  | "pending"
  | "approved"
  | "authorized"
  | "in_process"
  | "in_mediation"
  | "rejected"
  | "cancelled"
  | "refunded"
  | "charged_back"
  | (string & {});

/** Un pago tal como figura en el proveedor: la fuente de verdad del dinero. */
export type ProviderPayment = {
  id: string;
  status: ProviderPaymentStatus;
  statusDetail: string | null;
  amount: number;
  currency: string | null;
  /** Lo que mandamos al crear la preferencia: el id de la reserva. */
  externalReference: string | null;
  /** Cuenta que cobró (la del docente). */
  collectorId: string | null;
  /** Cuánto se devolvió hasta ahora (0 si nada). */
  refundedAmount: number;
};

export type CreateCheckoutInput = {
  bookingId: string;
  title: string;
  /** Precio de la clase en pesos. */
  amount: number;
  /** Comisión de la plataforma en pesos (va a la cuenta de EstudiApp). */
  marketplaceFee: number;
  notificationUrl: string;
  backUrls: { success: string; failure: string; pending: string };
  /** Fin de la retención del horario: pasado ese momento el link ya no cobra. */
  expiresAt: Date;
  payerEmail?: string;
};

export type ProviderCheckout = {
  id: string;
  /** Link donde paga el alumno. */
  checkoutUrl: string;
  /** Link equivalente en el entorno de prueba. */
  sandboxCheckoutUrl: string | null;
};

export type RefundInput = {
  paymentId: string;
  /** Monto a devolver; si falta, se devuelve el pago completo. */
  amount?: number;
  /** Misma clave = misma operación: reintentar nunca devuelve dos veces. */
  idempotencyKey: string;
};

export type ProviderRefund = {
  id: string;
  status: string;
  amount: number | null;
};

export interface PaymentProvider {
  getPayment(ctx: AccessContext, paymentId: string): Promise<ProviderPayment>;
  createCheckout(ctx: AccessContext, input: CreateCheckoutInput): Promise<ProviderCheckout>;
  refundPayment(ctx: AccessContext, input: RefundInput): Promise<ProviderRefund>;
}
