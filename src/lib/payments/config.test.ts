import { describe, expect, it } from "vitest";
import { paymentsConfigured } from "./config";

const complete = {
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
  MERCADOPAGO_WEBHOOK_SECRET: "webhook-secret",
  NEXT_PUBLIC_SITE_URL: "https://estudiapp.example",
  MERCADOPAGO_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
};

describe("paymentsConfigured", () => {
  it("ofrece cobrar solo si están todas las piezas", () => {
    expect(paymentsConfigured(complete)).toBe(true);
    expect(paymentsConfigured({ ...complete, MERCADOPAGO_WEBHOOK_SECRET: " " })).toBe(false);
    expect(paymentsConfigured({ ...complete, SUPABASE_SERVICE_ROLE_KEY: undefined })).toBe(false);
    expect(paymentsConfigured({ ...complete, MERCADOPAGO_TOKEN_ENCRYPTION_KEY: "corta" })).toBe(false);
  });
});
