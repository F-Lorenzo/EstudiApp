import { z } from "zod";
import { runtimeEnv } from "@/lib/runtime-env";
import type {
  AccessContext,
  CreatePaymentInput,
  PaymentProvider,
  ProviderPayment,
  ProviderRefund,
  RefundInput,
} from "../provider";
import { MercadoPagoError, isRetryableStatus } from "./errors";
import {
  errorBodySchema,
  oauthTokenResponseSchema,
  paymentResponseSchema,
  refundResponseSchema,
} from "./schemas";

const API_BASE = "https://api.mercadopago.com";
// Mercado Pago opera por país: el alta de la cuenta de cobro de los docentes es la argentina.
const AUTH_BASE = "https://auth.mercadopago.com.ar";
// El aviso (webhook) tiene que responderse en menos de 22 s: cada intento corta a los 8 s.
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const MAX_RETRY_AFTER_MS = 4_000;
const PAYMENT_ID = /^\d{1,20}$/;
// La referencia externa es el id de una reserva (UUID). Se valida antes de armar con ella una dirección.
const EXTERNAL_REFERENCE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Una reserva tiene uno o dos pagos como mucho; el tope evita leer una respuesta desmedida.
const SEARCH_LIMIT = 10;

/**
 * Respuesta de la búsqueda de pagos. Cada resultado se valida por separado: uno con un formato
 * inesperado se descarta en lugar de tirar abajo toda la consulta (es una ayuda de reconciliación; el
 * camino principal sigue siendo el aviso).
 */
const paymentSearchResponseSchema = z.object({ results: z.array(z.unknown()) });

export type MercadoPagoClientOptions = {
  clientId?: string;
  clientSecret?: string;
  baseUrl?: string;
  authBaseUrl?: string;
  fetch?: typeof fetch;
  /** Pausa entre reintentos; se inyecta en las pruebas. */
  sleep?: (ms: number) => Promise<void>;
  /** Devuelve un número entre 0 y 1 (variación de las pausas); se inyecta en las pruebas. */
  random?: () => number;
  now?: () => Date;
  timeoutMs?: number;
  maxAttempts?: number;
  /**
   * Pide credenciales de PRUEBA al vincular (`test_token=true` en el canje del código). Sirve para vincular un
   * vendedor de prueba a la aplicación real: Mercado Pago devuelve un token y una clave pública `TEST-`, y los
   * pagos se hacen con tarjetas de prueba. Solo para probar: con docentes reales tiene que estar apagado.
   */
  oauthTestToken?: boolean;
};

export type OAuthTokens = {
  accessToken: string;
  refreshToken: string;
  /** Id de la cuenta de Mercado Pago del docente. */
  mpUserId: string;
  publicKey: string | null;
  liveMode: boolean | null;
  expiresAt: Date;
};

type RequestOptions = {
  method: "GET" | "POST";
  url: string;
  accessToken?: string;
  body?: unknown;
  /** El endpoint OAuth sigue el formato estándar de formularios; los demás usan JSON. */
  bodyFormat?: "json" | "form";
  idempotencyKey?: string;
  /**
   * `always`: repetir el pedido es seguro (una consulta, o una operación con clave de idempotencia).
   * `never`: un reintento a ciegas puede hacer daño (el código de OAuth se usa una sola vez; el
   * refresh_token se renueva en cada canje y si se pierde la respuesta se pierde la cuenta vinculada).
   */
  retry: "always" | "never";
};

export class MercadoPagoClient implements PaymentProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly now: () => Date;
  private readonly baseUrl: string;
  private readonly authBaseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;

  constructor(private readonly options: MercadoPagoClientOptions = {}) {
    this.fetchImpl = options.fetch ?? ((...args) => fetch(...args));
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.random = options.random ?? Math.random;
    this.now = options.now ?? (() => new Date());
    this.baseUrl = options.baseUrl ?? API_BASE;
    this.authBaseUrl = options.authBaseUrl ?? AUTH_BASE;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  }

  // --- Pagos ----------------------------------------------------------------------------------------------

  async getPayment({ accessToken }: AccessContext, paymentId: string): Promise<ProviderPayment> {
    const payment = await this.request(paymentResponseSchema, {
      method: "GET",
      url: `${this.baseUrl}/v1/payments/${this.safePaymentId(paymentId)}`,
      accessToken,
      retry: "always",
    });
    return toProviderPayment(payment);
  }

  /**
   * Busca los pagos de una referencia externa (el id de la reserva) con el token del docente, del más viejo
   * al más nuevo: si la reserva tuviera dos pagos aprobados, gana el primero y la base devuelve el segundo.
   *
   * A VERIFICAR EN SANDBOX: que `GET /v1/payments/search` acepte `external_reference`, `sort`, `criteria` y
   * `limit` con el token de un vendedor del marketplace, y que devuelva los campos que lee
   * `paymentResponseSchema` (en particular `collector_id`). Mientras no se compruebe, esto es solo una ayuda
   * para recuperar avisos perdidos: si falla, el alumno sigue pudiendo confirmar por el aviso normal.
   */
  async searchPaymentsByReference({ accessToken }: AccessContext, externalReference: string): Promise<ProviderPayment[]> {
    if (!EXTERNAL_REFERENCE.test(externalReference)) {
      throw new MercadoPagoError("La referencia del pago no es válida.", { kind: "invalid_request", retryable: false });
    }
    const query = new URLSearchParams({
      external_reference: externalReference,
      sort: "date_created",
      criteria: "asc",
      limit: String(SEARCH_LIMIT),
    });
    const { results } = await this.request(paymentSearchResponseSchema, {
      method: "GET",
      url: `${this.baseUrl}/v1/payments/search?${query.toString()}`,
      accessToken,
      retry: "always",
    });
    return results.flatMap((result) => {
      const parsed = paymentResponseSchema.safeParse(result);
      return parsed.success ? [toProviderPayment(parsed.data)] : [];
    });
  }

  /**
   * Cobra con tarjeta (Checkout API) con el token del docente: la plata entra a su cuenta y la comisión
   * (`application_fee`) a la de la plataforma. El token de la tarjeta lo generó el navegador con la clave
   * pública del mismo docente. `binary_mode` hace que el pago se apruebe o se rechace en el momento (nada de
   * «en revisión»): la reserva solo está retenida 15 minutos.
   *
   * La clave de idempotencia evita cobrar dos veces si se repite el pedido (reintento o doble clic).
   */
  async createPayment({ accessToken }: AccessContext, input: CreatePaymentInput): Promise<ProviderPayment> {
    const payment = await this.request(paymentResponseSchema, {
      method: "POST",
      url: `${this.baseUrl}/v1/payments`,
      accessToken,
      idempotencyKey: input.idempotencyKey,
      retry: "always",
      body: {
        transaction_amount: roundMoney(input.amount),
        token: input.cardToken,
        description: input.description,
        installments: input.installments,
        payment_method_id: input.paymentMethodId,
        ...(input.issuerId ? { issuer_id: input.issuerId } : {}),
        payer: {
          email: input.payer.email,
          ...(input.payer.identification ? { identification: input.payer.identification } : {}),
        },
        application_fee: roundMoney(input.applicationFee),
        external_reference: input.bookingId,
        notification_url: input.notificationUrl,
        statement_descriptor: "ESTUDIAPP",
        binary_mode: true,
      },
    });
    return toProviderPayment(payment);
  }

  /** Sin `amount` devuelve el pago completo; con `amount`, esa parte. La clave evita devolver dos veces. */
  async refundPayment({ accessToken }: AccessContext, input: RefundInput): Promise<ProviderRefund> {
    const refund = await this.request(refundResponseSchema, {
      method: "POST",
      url: `${this.baseUrl}/v1/payments/${this.safePaymentId(input.paymentId)}/refunds`,
      accessToken,
      idempotencyKey: input.idempotencyKey,
      retry: "always",
      ...(input.amount !== undefined ? { body: { amount: roundMoney(input.amount) } } : {}),
    });
    return { id: refund.id, status: refund.status ?? "approved", amount: refund.amount ?? null };
  }

  // --- Vinculación de la cuenta de cobro del docente (OAuth) ----------------------------------------------

  /** Dirección a la que se manda al docente para que autorice la vinculación. */
  buildAuthorizationUrl({ redirectUri, state }: { redirectUri: string; state: string }) {
    const url = new URL(`${this.authBaseUrl}/authorization`);
    url.searchParams.set("client_id", this.requireCredential("clientId"));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("platform_id", "mp");
    url.searchParams.set("state", state);
    url.searchParams.set("redirect_uri", redirectUri);
    return url.toString();
  }

  /** Canjea el código que vuelve del OAuth por los tokens del docente. El código se usa una sola vez. */
  exchangeAuthorizationCode({ code, redirectUri }: { code: string; redirectUri: string }) {
    return this.oauthToken({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      ...(this.options.oauthTestToken ? { test_token: "true" } : {}),
    });
  }

  /** Renueva los tokens antes de que venzan. Ojo: el refresh_token nuevo reemplaza al anterior. */
  refreshAccessToken(refreshToken: string) {
    return this.oauthToken({ grant_type: "refresh_token", refresh_token: refreshToken });
  }

  private async oauthToken(params: Record<string, string>): Promise<OAuthTokens> {
    const body = await this.request(oauthTokenResponseSchema, {
      method: "POST",
      url: `${this.baseUrl}/oauth/token`,
      retry: "never",
      bodyFormat: "form",
      body: {
        client_id: this.requireCredential("clientId"),
        client_secret: this.requireCredential("clientSecret"),
        ...params,
      },
    });
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      mpUserId: body.user_id,
      publicKey: body.public_key ?? null,
      liveMode: body.live_mode ?? null,
      expiresAt: new Date(this.now().getTime() + body.expires_in * 1000),
    };
  }

  // --- Infraestructura -----------------------------------------------------------------------------------

  private requireCredential(name: "clientId" | "clientSecret") {
    const value = this.options[name];
    if (!value) {
      throw new MercadoPagoError(
        name === "clientId" ? "Falta MERCADOPAGO_CLIENT_ID." : "Falta MERCADOPAGO_CLIENT_SECRET.",
        { kind: "invalid_request", retryable: false },
      );
    }
    return value;
  }

  /** El id llega de un aviso: se valida antes de armar con él una dirección. */
  private safePaymentId(paymentId: string) {
    if (!PAYMENT_ID.test(paymentId)) {
      throw new MercadoPagoError("El identificador del pago no es válido.", { kind: "invalid_request", retryable: false });
    }
    return paymentId;
  }

  private async request<T>(schema: z.ZodType<T>, options: RequestOptions): Promise<T> {
    const attempts = options.retry === "always" ? this.maxAttempts : 1;

    for (let attempt = 1; ; attempt++) {
      try {
        return await this.attempt(schema, options);
      } catch (error) {
        if (!(error instanceof MercadoPagoError) || !error.retryable || attempt >= attempts) throw error;
        await this.sleep(error.retryAfterMs ?? this.backoff(attempt));
      }
    }
  }

  private backoff(attempt: number) {
    const base = Math.min(250 * 2 ** (attempt - 1), 2_000);
    return Math.round(base * (0.5 + this.random() * 0.5));
  }

  private async attempt<T>(schema: z.ZodType<T>, options: RequestOptions): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (options.accessToken) headers.Authorization = `Bearer ${options.accessToken}`;
    if (options.body !== undefined) headers["Content-Type"] = options.bodyFormat === "form" ? "application/x-www-form-urlencoded" : "application/json";
    if (options.idempotencyKey) headers["X-Idempotency-Key"] = options.idempotencyKey;

    const requestBody =
      options.body === undefined
        ? undefined
        : options.bodyFormat === "form"
          ? new URLSearchParams(options.body as Record<string, string>).toString()
          : JSON.stringify(options.body);

    let response: Response;
    try {
      response = await this.fetchImpl(options.url, {
        method: options.method,
        headers,
        body: requestBody,
        signal: AbortSignal.timeout(this.timeoutMs),
        cache: "no-store",
      });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      throw new MercadoPagoError(
        timedOut ? "Mercado Pago no respondió a tiempo." : "No pudimos comunicarnos con Mercado Pago.",
        { kind: timedOut ? "timeout" : "network", retryable: true },
      );
    }

    const text = await response.text().catch(() => "");

    if (!response.ok) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const { message, code } = describeErrorBody(text);
      throw new MercadoPagoError(
        `Mercado Pago respondió ${response.status}${code ? ` (${code})` : ""}${message ? `: ${message}` : ""}`.slice(0, 300),
        {
          kind: "http",
          status: response.status,
          retryable: isRetryableStatus(response.status),
          code,
          retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, MAX_RETRY_AFTER_MS) : null,
        },
      );
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new MercadoPagoError("Mercado Pago respondió algo que no se pudo leer.", {
        kind: "invalid_response",
        status: response.status,
        retryable: false,
      });
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new MercadoPagoError("Mercado Pago respondió con un formato inesperado.", {
        kind: "invalid_response",
        status: response.status,
        retryable: false,
      });
    }
    return parsed.data;
  }
}

/** Mercado Pago responde errores como `{ message, error, status, cause: [{ code, description }] }`. */
function describeErrorBody(text: string): { message: string | null; code: string | null } {
  try {
    const parsed = errorBodySchema.safeParse(JSON.parse(text));
    if (!parsed.success) return { message: null, code: null };
    const cause = parsed.data.cause?.[0];
    return {
      message: parsed.data.message ?? cause?.description ?? null,
      code: parsed.data.error ?? (cause?.code != null ? String(cause.code) : null),
    };
  } catch {
    return { message: null, code: null };
  }
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function toProviderPayment(payment: z.infer<typeof paymentResponseSchema>): ProviderPayment {
  return {
    id: payment.id,
    status: payment.status,
    statusDetail: payment.status_detail ?? null,
    amount: payment.transaction_amount,
    currency: payment.currency_id ?? null,
    externalReference: payment.external_reference || null,
    collectorId: payment.collector_id ?? payment.collector?.id ?? null,
    refundedAmount: payment.transaction_amount_refunded ?? 0,
  };
}

/** Cliente con las credenciales de la aplicación de Mercado Pago (variables de entorno del servidor). */
export function createMercadoPagoClient(options: MercadoPagoClientOptions = {}) {
  const env = runtimeEnv();
  return new MercadoPagoClient({
    clientId: env.MERCADOPAGO_CLIENT_ID,
    clientSecret: env.MERCADOPAGO_CLIENT_SECRET,
    oauthTestToken: oauthTestTokenEnabled(env),
    ...options,
  });
}

/** `MERCADOPAGO_OAUTH_TEST_TOKEN=true`: vincular docentes con credenciales de prueba (ver `oauthTestToken`). */
export function oauthTestTokenEnabled(env: Record<string, string | undefined>): boolean {
  return env.MERCADOPAGO_OAUTH_TEST_TOKEN?.trim().toLowerCase() === "true";
}
