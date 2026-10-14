import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetWarnings } from "./log";
import { createEmailDeps, isEmailDeliveryConfigured } from "./production";

const FULL_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://proyecto.supabase.example",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-de-prueba",
  RESEND_API_KEY: "re_clave_de_prueba_123456",
  EMAIL_FROM: "EstudiApp <hola@estudiapp.example>",
};

beforeEach(() => resetWarnings());
afterEach(() => vi.unstubAllEnvs());

describe("isEmailDeliveryConfigured", () => {
  it("con todo configurado, sí", () => {
    expect(isEmailDeliveryConfigured(FULL_ENV)).toBe(true);
  });

  it.each(Object.keys(FULL_ENV))("sin %s, no", (missing) => {
    expect(isEmailDeliveryConfigured({ ...FULL_ENV, [missing]: undefined })).toBe(false);
    expect(isEmailDeliveryConfigured({ ...FULL_ENV, [missing]: "  " })).toBe(false);
  });

  it("un remitente con formato inválido cuenta como no configurado", () => {
    expect(isEmailDeliveryConfigured({ ...FULL_ENV, EMAIL_FROM: "EstudiApp" })).toBe(false);
  });

  it("no exige la dirección del sitio (los emails salen sin enlaces)", () => {
    expect(isEmailDeliveryConfigured({ ...FULL_ENV, NEXT_PUBLIC_SITE_URL: undefined })).toBe(true);
  });
});

describe("createEmailDeps", () => {
  const stubAll = () => {
    for (const [key, value] of Object.entries(FULL_ENV)) vi.stubEnv(key, value);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://estudiapp.example");
  };

  it("arma la base de datos, el sender de Resend y la dirección del sitio desde el entorno", () => {
    stubAll();
    const deps = createEmailDeps();
    expect(typeof deps.db.rpc).toBe("function");
    expect(deps.sender.configured).toBe(true);
    expect(deps.baseUrl).toBe("https://estudiapp.example");
  });

  it("sin la service role lanza, como el resto del código de servidor", () => {
    stubAll();
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(() => createEmailDeps()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("sin Resend no lanza: el sender queda no configurado y la bandeja deja los emails pendientes", () => {
    stubAll();
    vi.stubEnv("RESEND_API_KEY", "");
    expect(createEmailDeps().sender.configured).toBe(false);
  });

  it("sin la dirección del sitio no lanza: baseUrl es null y avisa una sola vez", () => {
    stubAll();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(createEmailDeps().baseUrl).toBeNull();
    expect(createEmailDeps().baseUrl).toBeNull();
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain("NEXT_PUBLIC_SITE_URL");
    error.mockRestore();
  });
});
