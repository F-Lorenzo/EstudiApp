import { beforeEach, describe, expect, it, vi } from "vitest";
import { catchRedirect, fakeSupabase } from "@/test/fake-supabase";
import { login } from "./actions";

const createClient = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", async () => {
  const { RedirectSignal } = await import("@/test/fake-supabase");
  return {
    redirect: (url: string) => {
      throw new RedirectSignal(url);
    },
  };
});
vi.mock("@/lib/supabase/server", () => ({ createClient }));

function formulario(campos: Record<string, string>) {
  const form = new FormData();
  for (const [clave, valor] of Object.entries(campos)) form.set(clave, valor);
  return form;
}

const VALIDO = { email: "ana@ejemplo.com", password: "una-clave-segura" };

function sesion(role: string | null) {
  return fakeSupabase({
    user: { id: "u1" },
    tables: { profiles: { data: role ? { role } : null } },
  });
}

beforeEach(() => createClient.mockReset());

describe("login", () => {
  it("con datos inválidos no llama a Supabase y conserva el email", async () => {
    const supabase = fakeSupabase();
    createClient.mockResolvedValue(supabase.client);

    const result = await login({}, formulario({ email: "no-es-un-email", password: "" }));

    expect(result.fieldErrors).toBeDefined();
    expect(result.values).toEqual({ email: "no-es-un-email" });
    expect(supabase.client.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("con credenciales incorrectas da un mensaje genérico (no revela si el email existe)", async () => {
    const supabase = fakeSupabase({ signIn: { error: { message: "Invalid login credentials" } } });
    createClient.mockResolvedValue(supabase.client);

    const result = await login({}, formulario(VALIDO));

    expect(result.error).toBe("Email o contraseña incorrectos");
    expect(result.values).toEqual({ email: VALIDO.email });
  });

  it.each([
    ["alumno", "/alumno"],
    ["docente", "/docente"],
    ["administrador", "/admin/docentes/pendientes"],
  ])("un %s va a su inicio", async (rol, inicio) => {
    createClient.mockResolvedValue(sesion(rol).client);
    expect(await catchRedirect(() => login({}, formulario(VALIDO)))).toBe(inicio);
  });

  it("respeta la ruta pedida si es interna", async () => {
    createClient.mockResolvedValue(sesion("alumno").client);
    const destino = await catchRedirect(() =>
      login({}, formulario({ ...VALIDO, redirectTo: "/alumno/proximas-clases" })),
    );
    expect(destino).toBe("/alumno/proximas-clases");
  });

  it.each(["https://evil.example", "//evil.example", "/\t/evil.example", "/\\evil.example"])(
    "ignora una ruta de salida del sitio (%j)",
    async (redirectTo) => {
      createClient.mockResolvedValue(sesion("docente").client);
      expect(await catchRedirect(() => login({}, formulario({ ...VALIDO, redirectTo })))).toBe("/docente");
    },
  );

  it("si no se puede leer el rol, entra como alumno (el rol más limitado)", async () => {
    createClient.mockResolvedValue(sesion(null).client);
    expect(await catchRedirect(() => login({}, formulario(VALIDO)))).toBe("/alumno");
  });
});
