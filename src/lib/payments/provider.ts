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
  /** Lo que mandamos al crear el pago: el id de la reserva. */
  externalReference: string | null;
  /** Cuenta que cobró (la del docente). */
  collectorId: string | null;
  /** Cuánto se devolvió hasta ahora (0 si nada). */
  refundedAmount: number;
};

/**
 * Un pago con tarjeta por Checkout API. La tarjeta la tokeniza el formulario de Mercado Pago en el navegador
 * (con la clave pública del DOCENTE): al servidor solo llega el token, nunca el número.
 */
export type CreatePaymentInput = {
  bookingId: string;
  description: string;
  /** Precio de la clase en pesos. */
  amount: number;
  /** Comisión de la plataforma en pesos (va a la cuenta de EstudiApp como `application_fee`). */
  applicationFee: number;
  notificationUrl: string;
  /** Token de la tarjeta (se usa una sola vez). */
  cardToken: string;
  paymentMethodId: string;
  issuerId: string | null;
  installments: number;
  payer: { email: string; identification: { type: string; number: string } | null };
  /** Misma clave = mismo pago: reintentar nunca cobra dos veces. */
  idempotencyKey: string;
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
  /**
   * Pagos de esa referencia externa (el id de la reserva) visibles con ese token. Sirve para
   * reconciliar: si un aviso se perdió o llegó tarde, se le pregunta a Mercado Pago qué pagos tiene la
   * reserva. Devuelve una lista vacía si no hay ninguno.
   */
  searchPaymentsByReference(ctx: AccessContext, externalReference: string): Promise<ProviderPayment[]>;
  /** Crea y procesa el pago en el momento: devuelve el pago ya aprobado o rechazado. */
  createPayment(ctx: AccessContext, input: CreatePaymentInput): Promise<ProviderPayment>;
  refundPayment(ctx: AccessContext, input: RefundInput): Promise<ProviderRefund>;
}
