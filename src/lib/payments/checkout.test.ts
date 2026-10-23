import { describe, expect, it, vi } from "vitest";
import { payBookingWithCard, prepareBookingPayment, type CheckoutDeps } from "./checkout";
import { MercadoPagoError } from "./mercadopago/errors";
import { SimulatedPaymentProvider } from "./simulated-provider";

const booking = {
  id: "b0000000-0000-4000-8000-000000000001",
  student_id: "a0000000-0000-0000-0000-000000000001",
  tutor_id: "d0000000-0000-0000-0000-000000000001",
  status: "pendiente_pago",
  price: 45000,
  commission_rate: 0.12,
  created_at: "2026-10-21T12:00:00.000Z",
  starts_at: "2026-10-22T12:00:00.000Z",
};

const SELLER_TOKEN = "APP_USR-token-docente";

function dependencies({
  row = booking,
  applyOutcome = "confirmada",
  ...overrides
}: Partial<CheckoutDeps> & { row?: typeof booking; applyOutcome?: string } = {}) {
  const provider = new SimulatedPaymentProvider().registerSeller(SELLER_TOKEN, "3757610146");
  const rpc = vi.fn(async (name: string) => {
    if (name === "booking_commission") return { data: 5400, error: null };
    if (name === "apply_payment_notification") return { data: { outcome: applyOutcome, detail: null, booking_id: booking.id }, error: null };
    throw new Error(`rpc inesperada: ${name}`);
  });
  const db = {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }) })),
      })),
    })),
    rpc,
  };

  const deps: CheckoutDeps = {
    db: db as unknown as CheckoutDeps["db"],
    provider,
    loadSellerTokenByTutor: async () => ({ tutorId: booking.tutor_id, accessToken: SELLER_TOKEN, publicKey: "APP_USR-publica-docente" }),
    siteUrl: "https://estudiapp.example/",
    now: () => new Date("2026-10-21T12:05:00.000Z"),
    log: () => undefined,
    ...overrides,
  };
  return { deps, provider, rpc };
}

const input = {
  bookingId: booking.id,
  studentId: booking.student_id,
  studentEmail: "alumna@example.com",
  tutorName: "María González",
};

const card = {
  token: "card-token-1",
  payment_method_id: "visa",
  issuer_id: "310",
  installments: 1,
  payer: { email: "alumna@example.com", identification: { type: "DNI", number: "12345678" } },
};

describe("preparar el pago", () => {
  it("devuelve la clave pública del docente y el precio de la base", async () => {
    const { deps } = dependencies();
    await expect(prepareBookingPayment(deps, input)).resolves.toEqual({
      ok: true,
      publicKey: "APP_USR-publica-docente",
      amount: 45000,
      payerEmail: "alumna@example.com",
    });
  });

  it("no sugiere el email de una cuenta demo", async () => {
    const { deps } = dependencies();
    const result = await prepareBookingPayment(deps, { ...input, studentEmail: "alumno@estudiapp.test" });
    expect(result).toMatchObject({ ok: true, payerEmail: null });
  });

  it("no ofrece pagar si el docente no tiene clave pública", async () => {
    const { deps } = dependencies({
      loadSellerTokenByTutor: async () => ({ tutorId: booking.tutor_id, accessToken: SELLER_TOKEN, publicKey: null }),
    });
    await expect(prepareBookingPayment(deps, input)).resolves.toMatchObject({ ok: false, code: "tutor_not_payable" });
  });

  it("no ofrece pagar una reserva de otra persona ni una vencida", async () => {
    const { deps } = dependencies();
    await expect(prepareBookingPayment(deps, { ...input, studentId: "otro" })).resolves.toMatchObject({ ok: false, code: "not_found" });

    const late = dependencies({ now: () => new Date("2026-10-21T12:15:00.000Z") });
    await expect(prepareBookingPayment(late.deps, input)).resolves.toMatchObject({ ok: false, code: "hold_expired", stale: true });
  });
});

describe("pagar con tarjeta", () => {
  it("cobra el precio de la base con la comisión, con el token del docente, y confirma en el momento", async () => {
    const { deps, provider, rpc } = dependencies();
    await expect(payBookingWithCard(deps, { ...input, card })).resolves.toEqual({ ok: true, status: "confirmed" });

    const call = provider.calls.find((c) => c.operation === "createPayment");
    expect(call?.accessToken).toBe(SELLER_TOKEN);
    expect(call?.detail).toMatchObject({
      bookingId: booking.id,
      amount: 45000,
      applicationFee: 5400,
      notificationUrl: "https://estudiapp.example/api/mercadopago/webhook",
      cardToken: "card-token-1",
      paymentMethodId: "visa",
      issuerId: "310",
      installments: 1,
    });
    expect(rpc).toHaveBeenCalledWith(
      "apply_payment_notification",
      expect.objectContaining({ p_booking_id: booking.id, p_status: "approved", p_amount: 45000, p_collector_id: "3757610146" }),
    );
  });

  it("repetir con el mismo token de tarjeta no cobra dos veces", async () => {
    const { deps, provider } = dependencies();
    await payBookingWithCard(deps, { ...input, card });
    await payBookingWithCard(deps, { ...input, card });
    expect(provider.payments.size).toBe(1);
  });

  it("un rechazo de la tarjeta no toca la base y explica el motivo", async () => {
    const { deps, rpc } = dependencies();
    const result = await payBookingWithCard(deps, { ...input, card: { ...card, token: "rechazada-1" } });
    expect(result).toMatchObject({ ok: false, code: "card_rejected" });
    expect(rpc).not.toHaveBeenCalledWith("apply_payment_notification", expect.anything());
  });

  it("si la base todavía no confirmó, la pantalla sigue consultando", async () => {
    const { deps } = dependencies({ applyOutcome: "pendiente" });
    await expect(payBookingWithCard(deps, { ...input, card })).resolves.toEqual({ ok: true, status: "processing" });
  });

  it("no cobra si la reserva ya no está pendiente", async () => {
    const { deps, provider } = dependencies({ row: { ...booking, status: "cancelada" } });
    await expect(payBookingWithCard(deps, { ...input, card })).resolves.toMatchObject({ ok: false, code: "not_pending" });
    expect(provider.calls).toHaveLength(0);
  });

  it("una falla pasajera de Mercado Pago se informa sin culpar a la tarjeta", async () => {
    const { deps, provider } = dependencies();
    provider.failNext("createPayment");
    await expect(payBookingWithCard(deps, { ...input, card })).resolves.toMatchObject({ ok: false, code: "provider_unavailable" });
  });

  it("si Mercado Pago no acepta el email del pagador, se lo dice a la persona", async () => {
    const { deps, provider } = dependencies();
    provider.failNext(
      "createPayment",
      new MercadoPagoError("400", { kind: "http", status: 400, retryable: false, code: "bad_request", causeCode: "4050" }),
    );
    await expect(payBookingWithCard(deps, { ...input, card })).resolves.toMatchObject({
      ok: false,
      code: "provider_rejected",
      error: expect.stringMatching(/email/),
    });
  });

  it("un token de docente rechazado no es culpa del alumno", async () => {
    const { deps, provider } = dependencies();
    provider.failNext("createPayment", new MercadoPagoError("401", { kind: "http", status: 401, retryable: false }));
    await expect(payBookingWithCard(deps, { ...input, card })).resolves.toMatchObject({ ok: false, code: "tutor_not_payable" });
  });
});
