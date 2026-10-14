import { describe, expect, it, vi } from "vitest";
import { BOOKING_ID, SELLER_MP_ID, SELLER_TOKEN, TUTOR_ID, fakeRpc, refundSummary } from "@/test/payments-kit";
import { MercadoPagoError } from "./mercadopago/errors";
import { processPaymentNotification } from "./notifications";
import type { PaymentProvider } from "./provider";
import { SellerTokenError } from "./seller-token";
import { SimulatedPaymentProvider } from "./simulated-provider";

const PAYMENT_ID = "1234567890";

function setup({
  rpc = {},
  payment = {},
  token = async () => ({ tutorId: TUTOR_ID, accessToken: SELLER_TOKEN }),
}: {
  rpc?: Parameters<typeof fakeRpc>[0];
  payment?: Record<string, unknown>;
  token?: (mpUserId: string) => Promise<{ tutorId: string; accessToken: string }>;
} = {}) {
  const provider = new SimulatedPaymentProvider().registerSeller(SELLER_TOKEN, SELLER_MP_ID);
  provider.addPayment({ id: PAYMENT_ID, externalReference: BOOKING_ID, collectorId: SELLER_MP_ID, ...payment });
  const db = fakeRpc({ apply_payment_notification: { data: { outcome: "confirmada" } }, ...rpc });
  const loadSellerToken = vi.fn(token);
  const run = (input = { dataId: PAYMENT_ID, userId: SELLER_MP_ID as string | null }) =>
    processPaymentNotification({ db: db.db, provider, loadSellerToken }, input);
  return { provider, db, loadSellerToken, run };
}

describe("pago aprobado", () => {
  it("consulta el pago con el token del docente y se lo pasa a la base tal cual", async () => {
    const { run, provider, db, loadSellerToken } = setup();
    expect(await run()).toEqual({ kind: "done", outcome: "confirmada", detail: null });

    expect(loadSellerToken).toHaveBeenCalledWith(SELLER_MP_ID);
    expect(provider.calls).toEqual([{ operation: "getPayment", accessToken: SELLER_TOKEN, detail: { paymentId: PAYMENT_ID } }]);
    expect(db.of("apply_payment_notification")[0].args).toEqual({
      p_mp_payment_id: PAYMENT_ID,
      p_booking_id: BOOKING_ID,
      p_status: "approved",
      p_amount: 10000,
      p_currency: "ARS",
      p_collector_id: SELLER_MP_ID,
      p_refunded_amount: 0,
    });
  });

  it("si la referencia no es una reserva nuestra, no inventa una", async () => {
    for (const externalReference of [null, "", "no-es-un-uuid", "123"]) {
      const { run, db } = setup({ payment: { externalReference } });
      await run();
      expect(db.of("apply_payment_notification")[0].args.p_booking_id, String(externalReference)).toBeNull();
    }
  });

  it("repetir el aviso devuelve lo mismo", async () => {
    const { run, db } = setup({ rpc: { apply_payment_notification: { data: { outcome: "ya_confirmada" } } } });
    expect(await run()).toMatchObject({ kind: "done", outcome: "ya_confirmada" });
    expect(await run()).toMatchObject({ kind: "done", outcome: "ya_confirmada" });
    expect(db.of("apply_payment_notification")).toHaveLength(2);
  });

  it.each(["pendiente", "rechazada", "ya_reembolsada", "reembolso_confirmado", "ignorado"])("«%s» se da por resuelto", async (outcome) => {
    const { run } = setup({ rpc: { apply_payment_notification: { data: { outcome, detail: "x" } } } });
    expect(await run()).toEqual({ kind: "done", outcome, detail: "x" });
  });
});

describe("la cuenta de cobro", () => {
  it("sin cuenta de cobro en el aviso no se consulta nada", async () => {
    const { run, provider, loadSellerToken } = setup();
    expect(await run({ dataId: PAYMENT_ID, userId: null })).toEqual({ kind: "attention", reason: "sin_cuenta_de_cobro" });
    expect(loadSellerToken).not.toHaveBeenCalled();
    expect(provider.calls).toHaveLength(0);
  });

  it("una cuenta que no conocemos queda para revisar (reintentar no la arregla)", async () => {
    const { run, provider } = setup({
      token: async () => {
        throw new SellerTokenError("unknown_seller");
      },
    });
    expect(await run()).toEqual({ kind: "attention", reason: "cuenta_de_cobro_desconocida" });
    expect(provider.calls).toHaveLength(0);
  });

  it.each(["expired", "unreadable", "lookup_failed"] as const)("token «%s»: se reintenta más tarde", async (reason) => {
    const { run } = setup({
      token: async () => {
        throw new SellerTokenError(reason);
      },
    });
    expect(await run()).toEqual({ kind: "retry", reason: `token_${reason}` });
  });

  it("un error que no es de token no se esconde", async () => {
    const { run } = setup({
      token: async () => {
        throw new Error("bug");
      },
    });
    await expect(run()).rejects.toThrow("bug");
  });

  it("un pago de otra cuenta no es visible con este token: se reintenta, no se confirma", async () => {
    const { run, db } = setup({ payment: { collectorId: "999" } });
    const result = await run();
    expect(result.kind).toBe("retry");
    expect(db.of("apply_payment_notification")).toHaveLength(0);
  });
});

describe("fallas al consultar el pago", () => {
  it.each([
    ["503 del servidor", new MercadoPagoError("Mercado Pago respondió 503", { kind: "http", status: 503, retryable: true })],
    ["tiempo agotado", new MercadoPagoError("Mercado Pago no respondió a tiempo.", { kind: "timeout", retryable: true })],
    ["el pago todavía no se puede consultar (404)", new MercadoPagoError("Mercado Pago respondió 404", { kind: "http", status: 404, retryable: false })],
  ])("%s → se reintenta", async (_label, error) => {
    const { run, provider, db } = setup();
    provider.failNext("getPayment", error);
    const result = await run();
    expect(result).toMatchObject({ kind: "retry" });
    expect(db.of("apply_payment_notification")).toHaveLength(0);
  });

  it("si Mercado Pago devuelve otro pago distinto del avisado, no se actúa", async () => {
    const db = fakeRpc();
    const provider: PaymentProvider = {
      getPayment: async () => ({ id: "999", status: "approved", statusDetail: null, amount: 1, currency: "ARS", externalReference: BOOKING_ID, collectorId: SELLER_MP_ID, refundedAmount: 0 }),
      searchPaymentsByReference: vi.fn(),
      createCheckout: vi.fn(),
      refundPayment: vi.fn(),
    };
    const result = await processPaymentNotification(
      { db: db.db, provider, loadSellerToken: async () => ({ tutorId: TUTOR_ID, accessToken: SELLER_TOKEN }) },
      { dataId: PAYMENT_ID, userId: SELLER_MP_ID },
    );
    expect(result).toEqual({ kind: "attention", reason: "pago_distinto_al_avisado" });
    expect(db.calls).toHaveLength(0);
  });
});

describe("respuestas de la base", () => {
  it("un error pasajero de la base se reintenta", async () => {
    const { run } = setup({ rpc: { apply_payment_notification: { error: { message: "connection reset" } } } });
    expect(await run()).toEqual({ kind: "retry", reason: "base: connection reset" });
  });

  it("un aviso inválido no se reintenta", async () => {
    const { run } = setup({ rpc: { apply_payment_notification: { error: { message: "Faltan datos", hint: "invalid_notification" } } } });
    expect(await run()).toEqual({ kind: "attention", reason: "aviso_inválido" });
  });

  it("una respuesta que no se entiende queda para revisar y no se reintenta a ciegas", async () => {
    for (const data of [null, "texto", { sin: "outcome" }, { outcome: "reembolso_encolado" /* sin datos del reembolso */ }]) {
      const { run } = setup({ rpc: { apply_payment_notification: { data } } });
      expect((await run()).kind, JSON.stringify(data)).toBe("attention");
    }
  });

  it("un resultado nuevo que este código no conoce queda para revisar", async () => {
    const { run } = setup({ rpc: { apply_payment_notification: { data: { outcome: "algo_nuevo" } } } });
    expect(await run()).toEqual({ kind: "attention", reason: "resultado_desconocido:algo_nuevo" });
  });

  it.each([
    ["cuenta_distinta", "requiere_revision:cuenta_distinta"],
    ["contracargo", "requiere_revision:contracargo"],
  ])("«requiere_revision» (%s) queda registrado para una persona", async (detail, reason) => {
    const { run } = setup({ rpc: { apply_payment_notification: { data: { outcome: "requiere_revision", detail } } } });
    expect(await run()).toEqual({ kind: "attention", reason });
  });
});

describe("pago que no se puede aceptar: reembolso automático", () => {
  const encolado = (refund = refundSummary()) => ({
    apply_payment_notification: { data: { outcome: "reembolso_encolado", detail: "hold_expired", refund } },
  });

  it("devuelve el total con la clave de idempotencia de la fila y anota el resultado", async () => {
    const { run, provider, db } = setup({ rpc: encolado() });
    expect(await run()).toEqual({ kind: "done", outcome: "reembolso_encolado", detail: "hold_expired" });

    expect(provider.refunds).toHaveLength(1);
    expect(provider.calls.at(-1)).toMatchObject({
      operation: "refundPayment",
      accessToken: SELLER_TOKEN,
      detail: { paymentId: PAYMENT_ID, idempotencyKey: "k0000000-0000-4000-8000-000000000001" },
    });
    // 100 %: sin monto (pago completo).
    expect((provider.calls.at(-1)?.detail as { amount?: number }).amount).toBeUndefined();
    expect(db.of("mark_refund_result")[0].args).toEqual({
      p_refund_id: "f0000000-0000-4000-8000-000000000001",
      p_status: "aprobado",
      p_mp_refund_id: provider.refunds[0].id,
      p_detail: null,
    });
  });

  it("un reembolso parcial lleva el monto", async () => {
    const { run, provider } = setup({ rpc: encolado(refundSummary({ percent: 50, amount: 5000 })) });
    await run();
    expect(provider.refunds[0].amount).toBe(5000);
    expect((provider.calls.at(-1)?.detail as { amount?: number }).amount).toBe(5000);
  });

  it("si el reembolso ya estaba aprobado no se devuelve otra vez", async () => {
    const { run, provider, db } = setup({
      rpc: { apply_payment_notification: { data: { outcome: "reembolso_existente", refund: refundSummary({ status: "aprobado" }) } } },
    });
    expect(await run()).toMatchObject({ kind: "done", outcome: "reembolso_existente" });
    expect(provider.refunds).toHaveLength(0);
    expect(db.of("mark_refund_result")).toHaveLength(0);
  });

  it("un reembolso pendiente que ya existía se retoma con la misma clave", async () => {
    const { run, provider } = setup({
      rpc: { apply_payment_notification: { data: { outcome: "reembolso_existente", refund: refundSummary({ status: "fallido" }) } } },
    });
    await run();
    expect(provider.refunds).toHaveLength(1);
    expect(provider.refunds[0].idempotencyKey).toBe("k0000000-0000-4000-8000-000000000001");
  });

  it("repetir el aviso no devuelve dos veces (misma clave)", async () => {
    const { run, provider } = setup({ rpc: encolado() });
    await run();
    await run();
    expect(provider.refunds).toHaveLength(1);
    expect(provider.payments.get(PAYMENT_ID)?.refundedAmount).toBe(10000);
  });

  it("si Mercado Pago falla de forma pasajera, el reembolso queda «fallido» y se reintenta", async () => {
    const { run, provider, db } = setup({ rpc: encolado() });
    provider.failNext("refundPayment");
    const result = await run();
    expect(result).toMatchObject({ kind: "retry" });
    expect(db.of("mark_refund_result")[0].args).toMatchObject({ p_status: "fallido", p_mp_refund_id: null });
    expect(provider.refunds).toHaveLength(0);
  });

  it("si Mercado Pago lo rechaza para siempre, queda para revisar", async () => {
    const { run, provider, db } = setup({ rpc: encolado() });
    provider.failNext("refundPayment", new MercadoPagoError("Mercado Pago respondió 400 (bad_request): saldo insuficiente", { kind: "http", status: 400, retryable: false }));
    const result = await run();
    expect(result).toMatchObject({ kind: "attention" });
    expect((result as { reason: string }).reason).toMatch(/saldo insuficiente/);
    expect(db.of("mark_refund_result")[0].args).toMatchObject({ p_status: "fallido" });
  });

  it("si el reembolso salió pero no se pudo anotar, se reintenta (y la clave evita devolver de nuevo)", async () => {
    const { run, provider } = setup({
      rpc: { ...encolado(), mark_refund_result: { error: { message: "db caída" } } },
    });
    expect(await run()).toMatchObject({ kind: "retry" });
    expect(provider.refunds).toHaveLength(1);
    // El reintento vuelve a pedirlo con la misma clave: no hay un segundo reembolso.
    await run();
    expect(provider.refunds).toHaveLength(1);
  });

  it("el reembolso va con el token del docente que cobró, nunca con otro", async () => {
    const { run, provider } = setup({ rpc: encolado() });
    await run();
    expect(provider.calls.filter((call) => call.operation === "refundPayment").every((call) => call.accessToken === SELLER_TOKEN)).toBe(true);
  });
});
