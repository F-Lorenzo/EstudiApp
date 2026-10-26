import { describe, expect, it } from "vitest";
import { EMAIL_KINDS } from "@/lib/email/templates";
import { emailKindLabel, getEmailOutboxSummary, getEmailSetup } from "./email-status";

const FULL = {
  RESEND_API_KEY: "re_clave_de_prueba_123456",
  EMAIL_FROM: "EstudiApp <avisos@mail.estudiapp.example>",
  NEXT_PUBLIC_SUPABASE_URL: "https://proyecto.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
  NEXT_PUBLIC_SITE_URL: "https://estudiapp.example",
};

describe("getEmailSetup", () => {
  it("con todo cargado, está listo y no expone la clave", () => {
    const setup = getEmailSetup(FULL);
    expect(setup).toMatchObject({ apiKey: true, fromValid: true, replyTo: null, replyToValid: true, serviceRole: true, ready: true });
    expect(setup.siteUrl).toBe("https://estudiapp.example");
    expect(JSON.stringify(setup)).not.toContain("re_clave");
  });

  it("sin clave o con un remitente inválido, no está listo", () => {
    expect(getEmailSetup({ ...FULL, RESEND_API_KEY: " " }).ready).toBe(false);
    expect(getEmailSetup({ ...FULL, EMAIL_FROM: "EstudiApp" })).toMatchObject({ fromValid: false, ready: false });
    expect(getEmailSetup({ ...FULL, EMAIL_FROM: undefined })).toMatchObject({ from: null, ready: false });
    expect(getEmailSetup({ ...FULL, SUPABASE_SERVICE_ROLE_KEY: "" })).toMatchObject({ serviceRole: false, ready: false });
  });

  it("el «responder a» es opcional, pero si está tiene que ser un email", () => {
    expect(getEmailSetup({ ...FULL, EMAIL_REPLY_TO: "soporte@estudiapp.example" })).toMatchObject({ replyTo: "soporte@estudiapp.example", replyToValid: true, ready: true });
    expect(getEmailSetup({ ...FULL, EMAIL_REPLY_TO: "soporte" })).toMatchObject({ replyToValid: false, ready: false });
  });

  it("sin dirección del sitio sigue listo (los emails salen sin botones)", () => {
    expect(getEmailSetup({ ...FULL, NEXT_PUBLIC_SITE_URL: "" })).toMatchObject({ siteUrl: null, ready: true });
  });
});

describe("getEmailOutboxSummary", () => {
  const rpc = (data: unknown, error: unknown = null) => ({ rpc: async () => ({ data, error }) }) as never;
  const ok = {
    last_7_days: { enviado: 3, pendiente: "1", fallido: 0, omitido: 2 },
    waiting: 1,
    oldest_waiting_at: "2026-10-26T10:00:00Z",
    last_sent_at: null,
    problems: [{ kind: "reserva_confirmada", status: "omitido", attempts: 0, error: "Venció sin enviarse (48 horas).", at: "2026-10-26T10:00:00Z" }],
  };

  it("lee el resumen de la base", async () => {
    const { summary, error } = await getEmailOutboxSummary(rpc(ok));
    expect(error).toBe(false);
    expect(summary?.last_7_days.pendiente).toBe(1);
    expect(summary?.problems[0].error).toContain("Venció");
  });

  it("un error de la base o una forma inesperada es un error", async () => {
    expect((await getEmailOutboxSummary(rpc(null, { message: "not_admin" }))).error).toBe(true);
    expect((await getEmailOutboxSummary(rpc({ waiting: 1 }))).error).toBe(true);
  });
});

it("cada tipo de email tiene su nombre", () => {
  for (const kind of EMAIL_KINDS) expect(emailKindLabel(kind)).not.toBe(kind);
  expect(emailKindLabel("otro")).toBe("otro");
});
