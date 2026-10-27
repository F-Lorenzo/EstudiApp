import { describe, expect, it } from "vitest";
import { getSystemStatus, pendingChecks, type SystemGroup } from "./system-status";

const READY = {
  NEXT_PUBLIC_SITE_URL: "https://estudiapp.app",
  NEXT_PUBLIC_SUPABASE_URL: "https://proyecto.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "clave-publica",
  SUPABASE_SERVICE_ROLE_KEY: "clave-de-servicio-secreta",
  MERCADOPAGO_CLIENT_ID: "123",
  MERCADOPAGO_CLIENT_SECRET: "secreto-mp",
  MERCADOPAGO_WEBHOOK_SECRET: "secreto-de-la-firma",
  MERCADOPAGO_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  DAILY_API_KEY: "clave-daily",
  RESEND_API_KEY: "re_clave",
  EMAIL_FROM: "EstudiApp <avisos@estudiapp.app>",
  CRON_SECRET: "secreto-cron",
  TURNSTILE_SITE_KEY: "0x4AAA",
  TURNSTILE_SECRET_KEY: "0x4BBB-secreta",
};
const find = (groups: SystemGroup[], label: RegExp) => groups.flatMap((g) => g.checks).find((c) => label.test(c.label))!;
const status = (env: Record<string, string | undefined>, extra: { rateLimiters?: boolean; databaseCurrent?: boolean | null } = {}) =>
  getSystemStatus({ env, rateLimiters: extra.rateLimiters ?? true, databaseCurrent: "databaseCurrent" in extra ? (extra.databaseCurrent ?? null) : true });

describe("getSystemStatus", () => {
  it("con todo cargado no queda nada para revisar; la indexación apagada no cuenta", () => {
    const groups = status(READY);
    expect(pendingChecks(groups)).toBe(0);
    expect(find(groups, /Indexación/)).toMatchObject({ status: "apagado", value: "Apagada" });
    expect(find(groups, /Indexación/).status).not.toBe("revisar");
  });

  it("nunca muestra el valor de una clave", () => {
    const text = JSON.stringify(status(READY));
    for (const secret of ["clave-de-servicio-secreta", "secreto-mp", "secreto-de-la-firma", READY.MERCADOPAGO_TOKEN_ENCRYPTION_KEY, "clave-daily", "re_clave", "secreto-cron", "0x4BBB-secreta"]) {
      expect(text).not.toContain(secret);
    }
    // Lo público sí: la dirección del sitio y la de los avisos de Mercado Pago.
    expect(find(status(READY), /Dirección de los avisos/).value).toBe("https://estudiapp.app/api/mercadopago/webhook");
  });

  it("sin la firma de los avisos no hay pago con tarjeta", () => {
    const groups = status({ ...READY, MERCADOPAGO_WEBHOOK_SECRET: "" });
    expect(find(groups, /MERCADOPAGO_WEBHOOK_SECRET/)).toMatchObject({ status: "revisar", value: "Falta" });
    expect(find(groups, /Pago con tarjeta/)).toMatchObject({ status: "revisar", value: "No disponible" });
  });

  it("marca lo que es solo para pruebas", () => {
    const groups = status({ ...READY, MERCADOPAGO_OAUTH_TEST_TOKEN: "true", ALLOW_SIMULATED_PAYMENTS: "true" });
    expect(find(groups, /OAUTH_TEST_TOKEN/)).toMatchObject({ status: "revisar", value: "Encendidas" });
    expect(find(groups, /Pago simulado/)).toMatchObject({ status: "revisar", value: "Encendido" });
    expect(pendingChecks(groups)).toBe(2);
  });

  it("detecta una clave de cifrado mal formada, una sola clave de Turnstile y la dirección sin https", () => {
    const groups = status({ ...READY, MERCADOPAGO_TOKEN_ENCRYPTION_KEY: "corta", TURNSTILE_SECRET_KEY: "", NEXT_PUBLIC_SITE_URL: "http://localhost:3000" });
    expect(find(groups, /TOKEN_ENCRYPTION_KEY/).value).toBe("Mal formada");
    expect(find(groups, /Turnstile/).value).toBe("Falta una de las dos");
    expect(find(groups, /NEXT_PUBLIC_SITE_URL/).status).toBe("revisar");
  });

  it("la base y los limitadores", () => {
    expect(find(status(READY, { databaseCurrent: false }), /Migraciones/).value).toBe("Falta la 0025");
    expect(find(status(READY, { databaseCurrent: null }), /Migraciones/).value).toBe("No se pudo comprobar");
    expect(find(status(READY, { rateLimiters: false }), /Límite/).status).toBe("revisar");
  });

  it("la indexación encendida se ve", () => {
    expect(find(status({ ...READY, SITE_INDEXABLE: "true" }), /Indexación/)).toMatchObject({ status: "ok", value: "Encendida" });
  });
});
