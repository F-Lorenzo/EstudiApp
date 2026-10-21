import { describe, expect, it } from "vitest";
import { sandboxCheckoutEnabled } from "./config";

describe("MERCADOPAGO_SANDBOX", () => {
  it("solo se habilita con el valor explícito true", () => {
    expect(sandboxCheckoutEnabled({ MERCADOPAGO_SANDBOX: "true" })).toBe(true);
    expect(sandboxCheckoutEnabled({ MERCADOPAGO_SANDBOX: " TRUE " })).toBe(true);
    expect(sandboxCheckoutEnabled({ MERCADOPAGO_SANDBOX: "false" })).toBe(false);
    expect(sandboxCheckoutEnabled({})).toBe(false);
  });
});
