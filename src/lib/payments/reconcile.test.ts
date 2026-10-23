import { describe, expect, it, vi } from "vitest";
import { BOOKING_ID, SELLER_MP_ID, SELLER_TOKEN, TUTOR_ID, fakeRpc } from "@/test/payments-kit";
import { createReconcileThrottle, reconcileBookingPayments } from "./reconcile";
import { SellerTokenError } from "./seller-token";
import { SimulatedPaymentProvider } from "./simulated-provider";

function setup({ outcome = "confirmada", token = async () => ({ tutorId: TUTOR_ID, accessToken: SELLER_TOKEN }) } = {}) {
  const provider = new SimulatedPaymentProvider().registerSeller(SELLER_TOKEN, SELLER_MP_ID);
  const db = fakeRpc({ apply_payment_notification: { data: { outcome } } });
  const loadSellerTokenByTutor = vi.fn(token);
  const run = (bookingId = BOOKING_ID) =>
    reconcileBookingPayments({ db: db.db, provider, loadSellerTokenByTutor }, { bookingId, tutorId: TUTOR_ID });
  return { provider, db, loadSellerTokenByTutor, run };
}

describe("reconciliar los pagos de una reserva", () => {
  it("pasa a la base solo los pagos APROBADOS de esa reserva, con el token del docente", async () => {
    const { provider, db, run } = setup();
    provider.addPayment({ id: "1", externalReference: BOOKING_ID, collectorId: SELLER_MP_ID });
    provider.addPayment({ id: "2", externalReference: BOOKING_ID, collectorId: SELLER_MP_ID, status: "rejected" });
    provider.addPayment({ id: "3", externalReference: "b0000000-0000-4000-8000-000000000999", collectorId: SELLER_MP_ID });
    // De otra cuenta de cobro: con el token de este docente ni se ve.
    provider.addPayment({ id: "4", externalReference: BOOKING_ID, collectorId: "999" });

    expect(await run()).toEqual({ checked: true, processed: 1, outcomes: ["confirmada"], problem: null });
    expect(db.of("apply_payment_notification").map((call) => call.args.p_mp_payment_id)).toEqual(["1"]);
    expect(provider.calls[0]).toMatchObject({ operation: "searchPaymentsByReference", accessToken: SELLER_TOKEN });
  });

  it("sin pagos no toca la base", async () => {
    const { db, run } = setup();
    expect(await run()).toEqual({ checked: true, processed: 0, outcomes: [], problem: null });
    expect(db.calls).toHaveLength(0);
  });

  it("una referencia que no es un UUID no se busca", async () => {
    const { provider, loadSellerTokenByTutor, run } = setup();
    expect(await run("no-es-una-reserva")).toMatchObject({ checked: false, problem: "reserva_invalida" });
    expect(loadSellerTokenByTutor).not.toHaveBeenCalled();
    expect(provider.calls).toHaveLength(0);
  });

  it("sin token del docente no consulta y lo informa", async () => {
    const { provider, run } = setup({
      token: async () => {
        throw new SellerTokenError("expired");
      },
    });
    expect(await run()).toMatchObject({ checked: false, problem: "token_expired" });
    expect(provider.calls).toHaveLength(0);
  });

  it("si Mercado Pago falla no lanza: devuelve el problema", async () => {
    const { provider, run } = setup();
    provider.failNext("searchPaymentsByReference");
    expect(await run()).toMatchObject({ checked: false, processed: 0, problem: expect.stringMatching(/^consulta:/) });
  });

  it("una falla al aplicar un pago se anota y no frena a los demás", async () => {
    const { provider, db, run } = setup();
    provider.addPayment({ id: "1", externalReference: BOOKING_ID, collectorId: SELLER_MP_ID });
    provider.addPayment({ id: "2", externalReference: BOOKING_ID, collectorId: SELLER_MP_ID });
    let first = true;
    (db.db.rpc as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      if (first) {
        first = false;
        return { data: null, error: { message: "caída" } };
      }
      return { data: { outcome: "ya_confirmada" }, error: null };
    });

    const report = await run();
    expect(report).toMatchObject({ checked: true, processed: 2, outcomes: ["retry", "ya_confirmada"] });
    expect(report.problem).toMatch(/caída/);
  });
});

describe("límite de frecuencia", () => {
  it("una consulta por reserva cada intervalo, y nunca dos a la vez", () => {
    let now = 0;
    const throttle = createReconcileThrottle({ minIntervalMs: 5_000, now: () => now });
    expect(throttle.acquire("a")).toBe(true);
    expect(throttle.acquire("a")).toBe(false); // en curso
    throttle.release("a");
    expect(throttle.acquire("a")).toBe(false); // todavía no pasó el intervalo
    expect(throttle.acquire("b")).toBe(true); // otra reserva no espera
    now = 5_000;
    expect(throttle.acquire("a")).toBe(true);
  });

  it("el mapa no crece sin tope: descarta marcas viejas y, si no puede, no deja consultar", () => {
    let now = 0;
    const throttle = createReconcileThrottle({ minIntervalMs: 1_000, maxEntries: 2, now: () => now });
    expect(throttle.acquire("a")).toBe(true);
    expect(throttle.acquire("b")).toBe(true);
    expect(throttle.acquire("c")).toBe(false); // lleno y nada viejo
    now = 1_000;
    expect(throttle.acquire("c")).toBe(true); // las viejas se descartaron
  });
});
