import { describe, expect, it, vi } from "vitest";
import { SELLER_MP_ID, SELLER_TOKEN, TUTOR_ID, fakeRpc, refundSummary } from "@/test/payments-kit";
import { MercadoPagoError } from "./mercadopago/errors";
import { retryPendingRefunds } from "./refund-sweep";
import { SIMULATED_PAYMENT_PREFIX } from "./refunds";
import { SellerTokenError } from "./seller-token";
import { SimulatedPaymentProvider } from "./simulated-provider";

const row = (overrides: Record<string, unknown> = {}) => refundSummary({ mp_user_id: SELLER_MP_ID, ...overrides });

function setup(rows: unknown[], token = async () => ({ tutorId: TUTOR_ID, accessToken: SELLER_TOKEN })) {
  const provider = new SimulatedPaymentProvider().registerSeller(SELLER_TOKEN, SELLER_MP_ID);
  provider.addPayment({ id: "1234567890", collectorId: SELLER_MP_ID });
  const db = fakeRpc({ retryable_refunds: { data: rows } });
  const loadTokenForAccount = vi.fn(token);
  const run = (limit?: number) => retryPendingRefunds({ db: db.db, provider, loadTokenForAccount, limit });
  return { provider, db, loadTokenForAccount, run };
}

describe("barrido de reembolsos", () => {
  it("reintenta cada reembolso con el token de la cuenta que cobró y lo anota", async () => {
    const { provider, db, run } = setup([row()]);
    expect(await run()).toMatchObject({ attempted: 1, approved: 1, failed: 0, skipped: 0 });
    expect(provider.refunds).toHaveLength(1);
    expect(provider.calls.at(-1)).toMatchObject({ operation: "refundPayment", accessToken: SELLER_TOKEN });
    expect(db.of("mark_refund_result")[0].args).toMatchObject({ p_status: "aprobado" });
  });

  it("pasarlo dos veces no devuelve dos veces (misma clave de idempotencia)", async () => {
    const { provider, run } = setup([row()]);
    await run();
    await run();
    expect(provider.refunds).toHaveLength(1);
  });

  it("un parcial manda el monto; el total, no", async () => {
    const { provider, run } = setup([row({ percent: 50, amount: 5000 })]);
    await run();
    expect(provider.calls.at(-1)?.detail).toMatchObject({ amount: 5000 });
  });

  it("busca el token una sola vez por cuenta", async () => {
    const { loadTokenForAccount, run } = setup([row({ id: "r1" }), row({ id: "r2", idempotency_key: "otra" })]);
    await run();
    expect(loadTokenForAccount).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["unknown_seller", "cuenta_desconocida"],
    ["expired", "token_vencido"],
    ["unreadable", "token_ilegible"],
    ["lookup_failed", "token_no_disponible"],
  ] as const)("sin token (%s) no lo intenta y lo deja en la cola", async (reason, skip) => {
    const { provider, run } = setup([row()], async () => {
      throw new SellerTokenError(reason);
    });
    expect(await run()).toMatchObject({ attempted: 0, skipped: 1, skippedDetails: [{ reason: skip }] });
    expect(provider.calls).toHaveLength(0);
  });

  it("sin cuenta de cobro, una fila ilegible o ya aprobada no se intenta", async () => {
    const { provider, run } = setup([row({ mp_user_id: null }), { cualquier: "cosa" }, row({ status: "aprobado" })]);
    const report = await run();
    expect(report).toMatchObject({ attempted: 0, skipped: 3 });
    expect(report.skippedDetails.map((detail) => detail.reason)).toEqual(["sin_cuenta_de_cobro", "fila_ilegible", "ya_aprobado"]);
    expect(provider.calls).toHaveLength(0);
  });

  it("un pago simulado se cierra sin proveedor ni token", async () => {
    const { provider, loadTokenForAccount, run } = setup([row({ mercadopago_payment_id: `${SIMULATED_PAYMENT_PREFIX}x`, mp_user_id: null })]);
    expect(await run()).toMatchObject({ attempted: 1, approved: 1 });
    expect(provider.calls).toHaveLength(0);
    expect(loadTokenForAccount).not.toHaveBeenCalled();
  });

  it("una falla de Mercado Pago queda anotada como fallida y no frena a las demás", async () => {
    const { provider, db, run } = setup([row({ id: "r1" }), row({ id: "r2", idempotency_key: "otra", percent: 50, amount: 100 })]);
    provider.failNext("refundPayment", new MercadoPagoError("Mercado Pago respondió 503", { kind: "http", status: 503, retryable: true }));
    const report = await run();
    expect(report).toMatchObject({ attempted: 2, approved: 1, failed: 1, failures: [{ refundId: "r1" }] });
    expect(db.of("mark_refund_result").map((call) => call.args.p_status)).toEqual(["fallido", "aprobado"]);
  });

  it("acota el límite que se le pide a la base (1 a 100)", async () => {
    for (const [limit, expected] of [[0, 25], [-5, 1], [500, 100], [10, 10]] as const) {
      const { db, run } = setup([]);
      await run(limit);
      expect(db.of("retryable_refunds")[0].args, String(limit)).toEqual({ p_limit: expected });
    }
  });

  it("si la base no responde, lanza (la ruta programada responde con error)", async () => {
    const provider = new SimulatedPaymentProvider();
    const db = fakeRpc({ retryable_refunds: { error: { message: "caída" } } });
    await expect(retryPendingRefunds({ db: db.db, provider, loadTokenForAccount: vi.fn() })).rejects.toThrow(/cola de reembolsos/);
  });
});
