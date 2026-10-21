import { describe, expect, it, vi } from "vitest";
import { createBookingCheckout, type CheckoutDeps } from "./checkout";

const booking = {
  id: "b0000000-0000-0000-0000-000000000001",
  student_id: "a0000000-0000-0000-0000-000000000001",
  tutor_id: "d0000000-0000-0000-0000-000000000001",
  status: "pendiente_pago",
  price: 45000,
  commission_rate: 0.12,
  created_at: "2026-10-21T12:00:00.000Z",
  starts_at: "2026-10-22T12:00:00.000Z",
};

function dependencies(overrides: Partial<CheckoutDeps> = {}): CheckoutDeps {
  const createCheckout = vi.fn().mockResolvedValue({
    id: "pref-1",
    checkoutUrl: "https://www.mercadopago.com.ar/checkout/prod",
    sandboxCheckoutUrl: "https://sandbox.mercadopago.com.ar/checkout/test",
  });
  const db = {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: booking, error: null }) })),
      })),
    })),
    rpc: vi.fn().mockResolvedValue({ data: 5400, error: null }),
  };

  return {
    db: db as unknown as CheckoutDeps["db"],
    provider: { createCheckout } as unknown as CheckoutDeps["provider"],
    loadSellerTokenByTutor: async () => ({ tutorId: booking.tutor_id, accessToken: "token", liveMode: true }),
    siteUrl: "https://estudiapp.example",
    now: () => new Date("2026-10-21T12:05:00.000Z"),
    log: () => undefined,
    ...overrides,
  };
}

const input = {
  bookingId: booking.id,
  studentId: booking.student_id,
  tutorName: "María González",
};

describe("checkout de Mercado Pago", () => {
  it("fuerza el enlace sandbox aunque el token OAuth esté marcado como live", async () => {
    const deps = dependencies({ useSandboxCheckout: true });

    await expect(createBookingCheckout(deps, input)).resolves.toEqual({
      ok: true,
      url: "https://sandbox.mercadopago.com.ar/checkout/test",
    });
  });

  it("no cae al checkout productivo si se pidió sandbox y Mercado Pago no devolvió su enlace", async () => {
    const deps = dependencies({
      useSandboxCheckout: true,
      provider: {
        createCheckout: vi.fn().mockResolvedValue({
          id: "pref-1",
          checkoutUrl: "https://www.mercadopago.com.ar/checkout/prod",
          sandboxCheckoutUrl: null,
        }),
      } as unknown as CheckoutDeps["provider"],
    });

    await expect(createBookingCheckout(deps, input)).resolves.toMatchObject({
      ok: false,
      code: "provider_rejected",
    });
  });
});
