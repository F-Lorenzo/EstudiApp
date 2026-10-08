import { beforeEach, describe, expect, it, vi } from "vitest";
import { catchRedirect, fakeSupabase } from "@/test/fake-supabase";
import { approveTutor, rejectTutor } from "./actions";

const revalidatePath = vi.hoisted(() => vi.fn());
const createClient = vi.hoisted(() => vi.fn());
const getViewer = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", async () => {
  const { RedirectSignal } = await import("@/test/fake-supabase");
  return {
    redirect: (url: string) => {
      throw new RedirectSignal(url);
    },
  };
});
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/auth/viewer", () => ({ getViewer }));

const TUTOR = "d1";
const ADMIN = { id: "ad", name: "Admin", role: "administrador" };

function motivo(texto: string) {
  const form = new FormData();
  form.set("reason", texto);
  return form;
}

beforeEach(() => {
  for (const mock of [revalidatePath, createClient, getViewer]) mock.mockReset();
});

describe("approveTutor", () => {
  it.each([
    ["una persona sin sesión", null],
    ["un alumno", { id: "a1", name: "A", role: "alumno" }],
    ["un docente", { id: "d1", name: "D", role: "docente" }],
  ])("no deja aprobar a %s y no toca la base", async (_quien, viewer) => {
    getViewer.mockResolvedValue(viewer);
    const supabase = fakeSupabase();
    createClient.mockResolvedValue(supabase.client);

    await expect(approveTutor(TUTOR)).rejects.toThrow(/No tenés permiso/);
    expect(supabase.client.from).not.toHaveBeenCalled();
  });

  it("la administración aprueba: pasa a «aprobado», borra el motivo y vuelve a la cola", async () => {
    getViewer.mockResolvedValue(ADMIN);
    const supabase = fakeSupabase();
    createClient.mockResolvedValue(supabase.client);

    const destino = await catchRedirect(() => approveTutor(TUTOR));

    const [consulta] = supabase.on("tutor_profiles");
    expect(consulta.calls).toContainEqual(["update", [{ verification_status: "aprobado", verification_reason: null }]]);
    expect(consulta.calls).toContainEqual(["eq", ["id", TUTOR]]);
    expect(destino).toBe("/admin/docentes/pendientes");
  });

  it("si la base rechaza el cambio, no muestra el detalle", async () => {
    getViewer.mockResolvedValue(ADMIN);
    createClient.mockResolvedValue(
      fakeSupabase({ tables: { tutor_profiles: { error: { message: "violates row-level security policy" } } } }).client,
    );

    const error = await approveTutor(TUTOR).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("No se pudo aprobar el perfil");
  });
});

describe("rejectTutor", () => {
  it("no deja rechazar a quien no es administración", async () => {
    getViewer.mockResolvedValue({ id: "d1", name: "D", role: "docente" });
    const supabase = fakeSupabase();
    createClient.mockResolvedValue(supabase.client);

    const result = await rejectTutor(TUTOR, {}, motivo("Falta el título"));

    expect(result).toEqual({ error: expect.stringMatching(/No tenés permiso/) });
    expect(supabase.client.from).not.toHaveBeenCalled();
  });

  it("exige un motivo y conserva lo escrito", async () => {
    getViewer.mockResolvedValue(ADMIN);
    createClient.mockResolvedValue(fakeSupabase().client);

    const result = await rejectTutor(TUTOR, {}, motivo(""));

    expect(result.fieldErrors?.reason?.length).toBeGreaterThan(0);
  });

  it("rechaza con el motivo y vuelve a la cola", async () => {
    getViewer.mockResolvedValue(ADMIN);
    const supabase = fakeSupabase();
    createClient.mockResolvedValue(supabase.client);

    const destino = await catchRedirect(() => rejectTutor(TUTOR, {}, motivo("El respaldo no se abre")));

    const [consulta] = supabase.on("tutor_profiles");
    expect(consulta.calls).toContainEqual([
      "update",
      [{ verification_status: "rechazado", verification_reason: "El respaldo no se abre" }],
    ]);
    expect(destino).toBe("/admin/docentes/pendientes");
  });

  it("si la base falla, conserva el motivo escrito y no muestra el detalle", async () => {
    getViewer.mockResolvedValue(ADMIN);
    createClient.mockResolvedValue(
      fakeSupabase({ tables: { tutor_profiles: { error: { message: "deadlock detected" } } } }).client,
    );

    const result = await rejectTutor(TUTOR, {}, motivo("Motivo largo y válido"));

    expect(result.error).toBe("No se pudo rechazar el perfil. Intentá de nuevo.");
    expect(result.values).toEqual({ reason: "Motivo largo y válido" });
    expect(JSON.stringify(result)).not.toContain("deadlock");
  });
});
