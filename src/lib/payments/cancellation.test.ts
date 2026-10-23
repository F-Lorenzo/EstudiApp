import { describe, expect, it, vi } from "vitest";
import { SELLER_MP_ID, SELLER_TOKEN, TUTOR_ID, fakeRpc, refundSummary } from "@/test/payments-kit";
import { parseCancelResult, settleCancelledBooking, settleCancellationRefund } from "./cancellation";
import { SIMULATED_PAYMENT_PREFIX } from "./refunds";
import { SellerTokenError } from "./seller-token";
import { SimulatedPaymentProvider } from "./simulated-provider";

const refund = (overrides: Record<string, unknown> = {}) =>
  refundSummary({ mp_user_id: SELLER_MP_ID, ...overrides }) as Parameters<typeof settleCancellationRefund>[1];

function setup(token = async () => ({ tutorId: TUTOR_ID, accessToken: SELLER_TOKEN })) {
  const provider = new SimulatedPaymentProvider().registerSeller(SELLER_TOKEN, SELLER_MP_ID);
  provider.addPayment({ id: "1234567890", collectorId: SELLER_MP_ID });
  const db = fakeRpc();
  const loadSellerToken = vi.fn(token);
  const log = vi.fn();
  return { provider, db, loadSellerToken, log, deps: { db: db.db, provider, loadSellerToken, log } };
}

const cancelData = (overrides: Record<string, unknown> = {}) => ({
  paid: true,
  percent: 100,
  amount: 10000,
  refund: refundSummary({ mp_user_id: SELLER_MP_ID }),
  cancelled_by: "alumno",
  ...overrides,
});

describe("leer el resultado de cancel_booking", () => {
  it("entiende el contrato y rechaza lo que no lo cumple", () => {
    expect(parseCancelResult(cancelData())).toMatchObject({ paid: true, percent: 100, cancelledBy: "alumno" });
    expect(parseCancelResult(cancelData({ refund: null }))).toMatchObject({ refund: null });
    expect(parseCancelResult({ paid: "sí" })).toBeNull();
    expect(parseCancelResult(null)).toBeNull();
    expect(parseCancelResult(cancelData({ cancelled_by: "otro" }))).toBeNull();
  });
});

describe("ejecutar el reembolso de una cancelación", () => {
  it("devuelve con el token de la cuenta que cobró", async () => {
    const { provider, db, loadSellerToken, deps } = setup();
    expect(await settleCancellationRefund(deps, refund())).toBe("aprobado");
    expect(loadSellerToken).toHaveBeenCalledWith(SELLER_MP_ID);
    expect(provider.refunds).toHaveLength(1);
    expect(db.of("mark_refund_result")[0].args).toMatchObject({ p_status: "aprobado" });
  });

  it("un reembolso ya aprobado no se repite", async () => {
    const { provider, deps } = setup();
    expect(await settleCancellationRefund(deps, refund({ status: "aprobado" }))).toBe("aprobado");
    expect(provider.calls).toHaveLength(0);
  });

  it("sin cuenta de cobro o sin token queda pendiente para el barrido", async () => {
    const { provider, deps } = setup(async () => {
      throw new SellerTokenError("expired");
    });
    expect(await settleCancellationRefund(deps, refund({ mp_user_id: null }))).toBe("pendiente");
    expect(await settleCancellationRefund(deps, refund())).toBe("pendiente");
    expect(provider.calls).toHaveLength(0);
  });

  it("si Mercado Pago falla queda fallido (el barrido lo reintenta)", async () => {
    const { provider, db, deps } = setup();
    provider.failNext("refundPayment");
    expect(await settleCancellationRefund(deps, refund())).toBe("fallido");
    expect(db.of("mark_refund_result")[0].args).toMatchObject({ p_status: "fallido" });
  });

  it("un pago simulado se da por devuelto sin tocar al proveedor", async () => {
    const { provider, loadSellerToken, deps } = setup();
    expect(await settleCancellationRefund(deps, refund({ mercadopago_payment_id: `${SIMULATED_PAYMENT_PREFIX}x`, mp_user_id: null }))).toBe("aprobado");
    expect(provider.calls).toHaveLength(0);
    expect(loadSellerToken).not.toHaveBeenCalled();
  });

  it("el log no lleva el mensaje del error (puede venir de afuera)", async () => {
    const { deps, log } = setup(async () => {
      throw new SellerTokenError("unreadable");
    });
    await settleCancellationRefund(deps, refund());
    expect(log).toHaveBeenCalledWith(expect.any(String), { refundId: expect.any(String), reason: "SellerTokenError:unreadable" });
  });
});

describe("todo lo que sigue a cancelar", () => {
  it("con reembolso: lo ejecuta y arma el resumen para la pantalla", async () => {
    const { deps } = setup();
    await expect(settleCancelledBooking(cancelData({ percent: 50, amount: 5000 }), () => deps)).resolves.toMatchObject({
      refund: { percent: 50, amount: 5000, status: "aprobado" },
    });
  });

  it("sin pago no hay reembolso ni se arman los servicios", async () => {
    const createDeps = vi.fn();
    const { refund: report } = await settleCancelledBooking(cancelData({ paid: false, percent: 0, amount: 0, refund: null }), createDeps);
    expect(report).toBeNull();
    expect(createDeps).not.toHaveBeenCalled();
  });

  it("si no se pueden armar los servicios, el reembolso queda pendiente y la cancelación sigue", async () => {
    const log = vi.fn();
    const result = await settleCancelledBooking(
      cancelData(),
      () => {
        throw new Error("falta SUPABASE_SERVICE_ROLE_KEY");
      },
      log,
    );
    expect(result.refund).toMatchObject({ status: "pendiente" });
    expect(log).toHaveBeenCalled();
  });

  it("una respuesta que no se entiende no ejecuta ningún reembolso", async () => {
    const createDeps = vi.fn();
    await expect(settleCancelledBooking({ raro: true }, createDeps, vi.fn())).resolves.toEqual({ result: null, refund: null });
    expect(createDeps).not.toHaveBeenCalled();
  });
});
