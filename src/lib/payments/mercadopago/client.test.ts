import { describe, expect, it, vi } from "vitest";
import { MercadoPagoClient } from "./client";
import { MercadoPagoError } from "./errors";

const TOKEN = "APP_USR-token-del-docente-123";
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

type Step = Response | Error;

/** Un `fetch` que devuelve las respuestas en orden y registra cada pedido. */
function setup(steps: Step[], options: ConstructorParameters<typeof MercadoPagoClient>[0] = {}) {
  const queue = [...steps];
  const calls: { url: string; init: RequestInit & { headers: Record<string, string> } }[] = [];
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init as RequestInit & { headers: Record<string, string> } });
    const step = queue.shift();
    if (!step) throw new Error("fetch llamado más veces de lo esperado");
    if (step instanceof Error) throw step;
    return step;
  });
  const sleeps: number[] = [];
  const client = new MercadoPagoClient({
    clientId: "client-1",
    clientSecret: "secret-1",
    fetch: fetchMock as unknown as typeof fetch,
    sleep: async (ms) => void sleeps.push(ms),
    random: () => 1,
    now: () => new Date("2026-10-08T12:00:00.000Z"),
    ...options,
  });
  return { client, calls, sleeps, fetchMock };
}

const payment = {
  id: 1234567890,
  status: "approved",
  status_detail: "accredited",
  transaction_amount: 10000,
  currency_id: "ARS",
  external_reference: "b0000000-0000-0000-0000-000000000001",
  collector_id: 111222333,
  transaction_amount_refunded: 0,
  campo_nuevo_que_no_conocemos: true,
};

describe("consultar un pago", () => {
  it("pide el pago con el token del docente y lo normaliza", async () => {
    const { client, calls } = setup([json(payment)]);
    const result = await client.getPayment({ accessToken: TOKEN }, "1234567890");

    expect(calls[0].url).toBe("https://api.mercadopago.com/v1/payments/1234567890");
    expect(calls[0].init.method).toBe("GET");
    expect(calls[0].init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(calls[0].init.body).toBeUndefined();
    expect(result).toEqual({
      id: "1234567890",
      status: "approved",
      statusDetail: "accredited",
      amount: 10000,
      currency: "ARS",
      externalReference: "b0000000-0000-0000-0000-000000000001",
      collectorId: "111222333",
      refundedAmount: 0,
    });
  });

  it("tolera campos ausentes y toma el cobrador de collector.id", async () => {
    const { client } = setup([json({ id: "55", status: "pending", transaction_amount: 10, collector: { id: 9 } })]);
    expect(await client.getPayment({ accessToken: TOKEN }, "55")).toMatchObject({
      currency: null,
      externalReference: null,
      collectorId: "9",
      refundedAmount: 0,
      statusDetail: null,
    });
  });

  it("no arma una dirección con un identificador que no sea numérico", async () => {
    const { client, fetchMock } = setup([]);
    for (const bad of ["", "abc", "123/../refunds", "12 3", "1".repeat(30), "-1"]) {
      await expect(client.getPayment({ accessToken: TOKEN }, bad), bad).rejects.toMatchObject({ kind: "invalid_request", retryable: false });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falla sin reintentar si Mercado Pago dice 404, 401 o 400", async () => {
    for (const status of [400, 401, 403, 404]) {
      const { client, fetchMock } = setup([json({ message: "payment not found", error: "not_found", status }, status)]);
      await expect(client.getPayment({ accessToken: TOKEN }, "1")).rejects.toMatchObject({ kind: "http", status, retryable: false });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it("reintenta los errores del servidor y sale bien en el segundo intento", async () => {
    const { client, fetchMock, sleeps } = setup([json({ message: "boom" }, 503), json(payment)]);
    expect((await client.getPayment({ accessToken: TOKEN }, "1")).status).toBe("approved");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([250]);
  });

  it("reintenta las caídas de red y los tiempos agotados", async () => {
    const timeout = Object.assign(new Error("timeout"), { name: "TimeoutError" });
    const { client, fetchMock } = setup([new TypeError("fetch failed"), timeout, json(payment)]);
    expect((await client.getPayment({ accessToken: TOKEN }, "1")).id).toBe("1234567890");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("se rinde después de los intentos y lo marca como reintentable", async () => {
    const { client, fetchMock, sleeps } = setup([json({}, 500), json({}, 502), json({}, 500)]);
    await expect(client.getPayment({ accessToken: TOKEN }, "1")).rejects.toMatchObject({ kind: "http", status: 500, retryable: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([250, 500]); // espera creciente, sin pausa después del último intento
  });

  it("distingue el tiempo agotado de la red caída", async () => {
    const timeout = Object.assign(new Error("x"), { name: "TimeoutError" });
    const a = setup([timeout, timeout, timeout]);
    await expect(a.client.getPayment({ accessToken: TOKEN }, "1")).rejects.toMatchObject({ kind: "timeout", retryable: true });
    const b = setup([new TypeError("x"), new TypeError("x"), new TypeError("x")]);
    await expect(b.client.getPayment({ accessToken: TOKEN }, "1")).rejects.toMatchObject({ kind: "network", retryable: true });
  });

  it("respeta Retry-After (con tope) cuando Mercado Pago limita el ritmo", async () => {
    const { client, sleeps } = setup([json({}, 429, { "retry-after": "2" }), json({}, 429, { "retry-after": "120" }), json(payment)]);
    await client.getPayment({ accessToken: TOKEN }, "1");
    expect(sleeps).toEqual([2000, 4000]);
  });

  it("no reintenta una respuesta buena pero ilegible o con otro formato", async () => {
    const a = setup([new Response("<html>", { status: 200 })]);
    await expect(a.client.getPayment({ accessToken: TOKEN }, "1")).rejects.toMatchObject({ kind: "invalid_response", retryable: false });
    expect(a.fetchMock).toHaveBeenCalledTimes(1);
    const b = setup([json({ id: 1, status: "approved" })]); // sin monto
    await expect(b.client.getPayment({ accessToken: TOKEN }, "1")).rejects.toMatchObject({ kind: "invalid_response" });
  });

  it("el mensaje de error nunca incluye el token", async () => {
    const { client } = setup([json({ message: "invalid access token", error: "unauthorized" }, 401)]);
    const error = await client.getPayment({ accessToken: TOKEN }, "1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MercadoPagoError);
    expect((error as Error).message).toBe("Mercado Pago respondió 401 (unauthorized): invalid access token");
    expect(JSON.stringify(error)).not.toContain(TOKEN);
  });
});

describe("cobrar con tarjeta (Checkout API)", () => {
  const input = {
    bookingId: "b0000000-0000-0000-0000-000000000001",
    description: "Clase de Matemática con Ana",
    amount: 10000,
    applicationFee: 1200,
    notificationUrl: "https://estudiapp.example/api/mercadopago/webhook",
    cardToken: "card-token-1",
    paymentMethodId: "visa",
    issuerId: "310",
    installments: 1,
    payer: { email: "alu@example.com", identification: { type: "DNI", number: "12345678" } },
    idempotencyKey: "pago-b1-abc",
  };

  it("manda la comisión, la referencia, el modo binario y la clave de idempotencia", async () => {
    const { client, calls } = setup([json(payment, 201)]);
    const result = await client.createPayment({ accessToken: TOKEN }, input);

    expect(calls[0].url).toBe("https://api.mercadopago.com/v1/payments");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(calls[0].init.headers["X-Idempotency-Key"]).toBe("pago-b1-abc");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      transaction_amount: 10000,
      token: "card-token-1",
      description: input.description,
      installments: 1,
      payment_method_id: "visa",
      issuer_id: "310",
      payer: { email: "alu@example.com", identification: { type: "DNI", number: "12345678" } },
      application_fee: 1200,
      external_reference: input.bookingId,
      notification_url: input.notificationUrl,
      statement_descriptor: "ESTUDIAPP",
      binary_mode: true,
    });
    expect(result).toMatchObject({ id: "1234567890", status: "approved", amount: 10000, collectorId: "111222333" });
  });

  it("redondea a centavos y omite el emisor y el documento si no vienen", async () => {
    const { client, calls } = setup([json(payment, 201)]);
    await client.createPayment(
      { accessToken: TOKEN },
      { ...input, amount: 8333.333, applicationFee: 999.996, issuerId: null, payer: { email: "alu@example.com", identification: null } },
    );
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.transaction_amount).toBe(8333.33);
    expect(body.application_fee).toBe(1000);
    expect(body).not.toHaveProperty("issuer_id");
    expect(body.payer).toEqual({ email: "alu@example.com" });
  });

  it("reintenta una falla pasajera con la MISMA clave de idempotencia", async () => {
    const { client, calls } = setup([json({ message: "busy" }, 503), json(payment, 201)]);
    await client.createPayment({ accessToken: TOKEN }, input);
    expect(calls).toHaveLength(2);
    expect(calls[1].init.headers["X-Idempotency-Key"]).toBe("pago-b1-abc");
  });
});

describe("reembolsar", () => {
  it("sin monto devuelve el pago completo (cuerpo vacío) y manda la clave de idempotencia", async () => {
    const { client, calls } = setup([json({ id: 777, status: "approved", amount: 10000 })]);
    const result = await client.refundPayment({ accessToken: TOKEN }, { paymentId: "1234567890", idempotencyKey: "key-1" });

    expect(calls[0].url).toBe("https://api.mercadopago.com/v1/payments/1234567890/refunds");
    expect(calls[0].init.headers["X-Idempotency-Key"]).toBe("key-1");
    expect(calls[0].init.body).toBeUndefined();
    expect(result).toEqual({ id: "777", status: "approved", amount: 10000 });
  });

  it("con monto manda el parcial", async () => {
    const { client, calls } = setup([json({ id: 778, status: "approved", amount: 5000 })]);
    await client.refundPayment({ accessToken: TOKEN }, { paymentId: "1", amount: 5000, idempotencyKey: "key-2" });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ amount: 5000 });
  });

  it("reintenta con LA MISMA clave: así un reintento nunca devuelve dos veces", async () => {
    const { client, calls } = setup([new TypeError("fetch failed"), json({ id: 1, status: "approved" })]);
    await client.refundPayment({ accessToken: TOKEN }, { paymentId: "9", idempotencyKey: "key-3" });
    expect(calls.map((c) => c.init.headers["X-Idempotency-Key"])).toEqual(["key-3", "key-3"]);
  });

  it("un rechazo de Mercado Pago no se reintenta", async () => {
    const { client, fetchMock } = setup([json({ message: "Not enough balance", error: "bad_request" }, 400)]);
    await expect(client.refundPayment({ accessToken: TOKEN }, { paymentId: "9", idempotencyKey: "k" })).rejects.toMatchObject({
      status: 400,
      retryable: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("vincular la cuenta del docente (OAuth)", () => {
  const tokens = {
    access_token: "APP_USR-nuevo",
    refresh_token: "TG-nuevo",
    user_id: 55501234,
    expires_in: 15552000,
    public_key: "APP_USR-pk",
    live_mode: true,
    token_type: "Bearer",
  };

  it("arma la dirección de autorización", () => {
    const { client } = setup([]);
    const url = new URL(client.buildAuthorizationUrl({ redirectUri: "https://estudiapp.example/api/mercadopago/oauth/callback", state: "estado-aleatorio" }));
    expect(url.origin + url.pathname).toBe("https://auth.mercadopago.com.ar/authorization");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "client-1",
      response_type: "code",
      platform_id: "mp",
      state: "estado-aleatorio",
      redirect_uri: "https://estudiapp.example/api/mercadopago/oauth/callback",
    });
  });

  it("canjea el código por los tokens y calcula cuándo vencen", async () => {
    const { client, calls } = setup([json(tokens)]);
    const result = await client.exchangeAuthorizationCode({ code: "TG-código", redirectUri: "https://estudiapp.example/cb" });

    expect(calls[0].url).toBe("https://api.mercadopago.com/oauth/token");
    expect(calls[0].init.headers.Authorization).toBeUndefined();
    expect(calls[0].init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(new URLSearchParams(String(calls[0].init.body)))).toEqual({
      client_id: "client-1",
      client_secret: "secret-1",
      grant_type: "authorization_code",
      code: "TG-código",
      redirect_uri: "https://estudiapp.example/cb",
    });
    expect(result).toEqual({
      accessToken: "APP_USR-nuevo",
      refreshToken: "TG-nuevo",
      mpUserId: "55501234",
      publicKey: "APP_USR-pk",
      liveMode: true,
      expiresAt: new Date("2027-04-06T12:00:00.000Z"), // 180 días después del 8 de octubre de 2026
    });
  });

  it("renueva con el refresh_token", async () => {
    const { client, calls } = setup([json(tokens)]);
    await client.refreshAccessToken("TG-viejo");
    expect(Object.fromEntries(new URLSearchParams(String(calls[0].init.body)))).toMatchObject({
      grant_type: "refresh_token",
      refresh_token: "TG-viejo",
    });
  });

  it("NUNCA reintenta solo: el código se usa una vez y el refresh_token se renueva en cada canje", async () => {
    for (const run of [
      (c: MercadoPagoClient) => c.exchangeAuthorizationCode({ code: "c", redirectUri: "https://x" }),
      (c: MercadoPagoClient) => c.refreshAccessToken("r"),
    ]) {
      const { client, fetchMock } = setup([json({ message: "boom" }, 503), json(tokens)]);
      await expect(run(client)).rejects.toMatchObject({ retryable: true });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it("falla con un mensaje claro si faltan las credenciales de la aplicación", async () => {
    const { client } = setup([], { clientId: undefined, clientSecret: undefined });
    expect(() => client.buildAuthorizationUrl({ redirectUri: "https://x", state: "s" })).toThrow(/MERCADOPAGO_CLIENT_ID/);
    await expect(client.refreshAccessToken("r")).rejects.toThrow(/MERCADOPAGO_CLIENT_ID/);
  });

  it("rechaza una respuesta sin tokens", async () => {
    const { client } = setup([json({ user_id: 1, expires_in: 10 })]);
    await expect(client.refreshAccessToken("r")).rejects.toMatchObject({ kind: "invalid_response" });
  });
});
