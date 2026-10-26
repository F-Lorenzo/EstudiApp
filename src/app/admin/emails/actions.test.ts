import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";
import { EmailSendError } from "@/lib/email/sender";
import { describeTestFailure } from "@/lib/email/test-email";
import { sendTestEmail } from "./actions";

const createClient = vi.hoisted(() => vi.fn());
const getViewer = vi.hoisted(() => vi.fn());
const runtimeEnv = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/auth/viewer", () => ({ getViewer }));
vi.mock("@/lib/runtime-env", () => ({ runtimeEnv }));

const ENV = {
  RESEND_API_KEY: "re_clave_de_prueba_123456",
  EMAIL_FROM: "EstudiApp <avisos@mail.estudiapp.example>",
  EMAIL_REPLY_TO: "soporte@estudiapp.example",
  NEXT_PUBLIC_SITE_URL: "https://estudiapp.example",
};
const ADMIN = { id: "ad", name: "Admin", role: "administrador" };

beforeEach(() => {
  for (const mock of [createClient, getViewer, runtimeEnv]) mock.mockReset();
  vi.unstubAllGlobals();
  runtimeEnv.mockReturnValue(ENV);
});

describe("sendTestEmail", () => {
  it("no deja probar a quien no es administración, y no manda nada", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    getViewer.mockResolvedValue({ id: "d1", name: "D", role: "docente" });
    expect((await sendTestEmail()).error).toMatch(/No tenés permiso/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("manda la prueba al email de la cuenta de administración, con el remitente y el «responder a»", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "re-1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    getViewer.mockResolvedValue(ADMIN);
    createClient.mockResolvedValue(fakeSupabase({ user: { id: "ad", email: "admin@estudiapp.example" } }).client);

    expect(await sendTestEmail()).toEqual({ success: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ from: ENV.EMAIL_FROM, to: ["admin@estudiapp.example"], reply_to: ENV.EMAIL_REPLY_TO, subject: "Email de prueba de EstudiApp" });
    expect(body.html).toContain("https://estudiapp.example");
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toMatch(/^prueba-/);
  });

  it("sin configuración, lo dice sin llamar a Resend", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    runtimeEnv.mockReturnValue({ ...ENV, RESEND_API_KEY: "" });
    getViewer.mockResolvedValue(ADMIN);
    createClient.mockResolvedValue(fakeSupabase({ user: { id: "ad", email: "admin@estudiapp.example" } }).client);
    expect((await sendTestEmail()).error).toMatch(/Falta configurar/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("un dominio sin verificar (403) se explica, sin la clave ni el destinatario", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ name: "validation_error", message: "domain not verified for admin@estudiapp.example" }), { status: 403 })));
    getViewer.mockResolvedValue(ADMIN);
    createClient.mockResolvedValue(fakeSupabase({ user: { id: "ad", email: "admin@estudiapp.example" } }).client);
    const { error } = await sendTestEmail();
    expect(error).toMatch(/dominio todavía no está verificado/);
    expect(error).not.toContain("admin@estudiapp.example");
    expect(error).not.toContain(ENV.RESEND_API_KEY);
  });

  it("una cuenta sin email no puede probar", async () => {
    getViewer.mockResolvedValue(ADMIN);
    createClient.mockResolvedValue(fakeSupabase({ user: { id: "ad" } }).client);
    expect((await sendTestEmail()).error).toMatch(/no tiene un email/);
  });
});

describe("describeTestFailure", () => {
  it("explica cada caso", () => {
    expect(describeTestFailure(new EmailSendError("x", { kind: "http", status: 401, retryable: true }))).toMatch(/clave \(401\)/);
    expect(describeTestFailure(new EmailSendError("x", { kind: "timeout", retryable: true }))).toMatch(/comunicarnos/);
    expect(describeTestFailure(new EmailSendError("Resend respondió 422 para a@b.com", { kind: "http", status: 422, retryable: false }))).toBe("Resend respondió 422 para [email]");
    expect(describeTestFailure(new Error("otra cosa"))).toBe("No se pudo enviar el email de prueba.");
  });
});
