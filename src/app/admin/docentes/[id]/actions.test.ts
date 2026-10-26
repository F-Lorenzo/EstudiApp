import { beforeEach, describe, expect, it, vi } from "vitest";
import { catchRedirect, fakeSupabase } from "@/test/fake-supabase";
import { approveTutor, deactivateTutor, rejectTutor, reopenTutor } from "./actions";

const revalidatePath = vi.hoisted(() => vi.fn());
const createClient = vi.hoisted(() => vi.fn());
const getViewer = vi.hoisted(() => vi.fn());
const scheduleEmailDelivery = vi.hoisted(() => vi.fn());

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
vi.mock("@/lib/email/schedule", () => ({ scheduleEmailDelivery }));

const TUTOR = "d1";
const ADMIN = { id: "ad", name: "Admin", role: "administrador" };
const NOT_ADMIN = [
  ["una persona sin sesión", null],
  ["un alumno", { id: "a1", name: "A", role: "alumno" }],
  ["un docente", { id: "d1", name: "D", role: "docente" }],
] as const;

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

function asAdmin(rpc?: { error: unknown }) {
  getViewer.mockResolvedValue(ADMIN);
  const supabase = fakeSupabase(rpc ? { rpc: { decide_tutor_profile: rpc } } : {});
  createClient.mockResolvedValue(supabase.client);
  return supabase;
}

beforeEach(() => {
  for (const mock of [revalidatePath, createClient, getViewer, scheduleEmailDelivery]) mock.mockReset();
});

describe("approveTutor", () => {
  it.each(NOT_ADMIN)("no deja aprobar a %s y no toca la base", async (_quien, viewer) => {
    getViewer.mockResolvedValue(viewer);
    const supabase = fakeSupabase();
    createClient.mockResolvedValue(supabase.client);

    await expect(approveTutor(TUTOR)).rejects.toThrow(/No tenés permiso/);
    expect(supabase.client.rpc).not.toHaveBeenCalled();
  });

  it("la administración aprueba con la función de la base, pide el email y vuelve a la cola", async () => {
    const supabase = asAdmin();
    const destino = await catchRedirect(() => approveTutor(TUTOR));

    expect(supabase.client.rpc).toHaveBeenCalledWith("decide_tutor_profile", { p_tutor_id: TUTOR, p_action: "aprobar", p_reason: null });
    expect(destino).toBe("/admin/docentes/pendientes");
    expect(scheduleEmailDelivery).toHaveBeenCalledOnce();
    expect(revalidatePath).toHaveBeenCalledWith("/admin/registro");
  });

  it("si la base rechaza el cambio, no muestra el detalle ni pide emails", async () => {
    asAdmin({ error: { message: "violates row-level security policy", hint: "not_admin" } });
    const error = await approveTutor(TUTOR).catch((e: Error) => e);
    expect((error as Error).message).toBe("No se pudo aprobar el perfil");
    expect(scheduleEmailDelivery).not.toHaveBeenCalled();
  });
});

describe("rejectTutor", () => {
  it("no deja rechazar a quien no es administración", async () => {
    getViewer.mockResolvedValue({ id: "d1", name: "D", role: "docente" });
    const supabase = fakeSupabase();
    createClient.mockResolvedValue(supabase.client);

    const result = await rejectTutor(TUTOR, {}, form({ reason: "Falta el título" }));
    expect(result).toEqual({ error: expect.stringMatching(/No tenés permiso/) });
    expect(supabase.client.rpc).not.toHaveBeenCalled();
  });

  it("exige un motivo", async () => {
    asAdmin();
    const result = await rejectTutor(TUTOR, {}, form({ reason: "  " }));
    expect(result.fieldErrors?.reason?.length).toBeGreaterThan(0);
  });

  it("rechaza con el motivo limpio y vuelve a la cola", async () => {
    const supabase = asAdmin();
    const destino = await catchRedirect(() => rejectTutor(TUTOR, {}, form({ reason: " El respaldo no se abre " })));

    expect(supabase.client.rpc).toHaveBeenCalledWith("decide_tutor_profile", {
      p_tutor_id: TUTOR,
      p_action: "rechazar",
      p_reason: "El respaldo no se abre",
    });
    expect(destino).toBe("/admin/docentes/pendientes");
    expect(scheduleEmailDelivery).toHaveBeenCalledOnce();
  });

  it("si la base falla, conserva el motivo escrito y no muestra el detalle", async () => {
    asAdmin({ error: { message: "deadlock detected" } });
    const result = await rejectTutor(TUTOR, {}, form({ reason: "Motivo largo y válido" }));

    expect(result.error).toBe("No se pudo rechazar el perfil. Intentá de nuevo.");
    expect(result.values).toEqual({ reason: "Motivo largo y válido" });
    expect(JSON.stringify(result)).not.toContain("deadlock");
    expect(scheduleEmailDelivery).not.toHaveBeenCalled();
  });

  it("si el perfil cambió mientras se revisaba, lo dice", async () => {
    asAdmin({ error: { message: "x", hint: "invalid_transition" } });
    const result = await rejectTutor(TUTOR, {}, form({ reason: "Motivo" }));
    expect(result.error).toMatch(/cambió mientras lo revisabas/);
  });
});

describe("deactivateTutor", () => {
  it.each(NOT_ADMIN)("no deja dar de baja a %s", async (_quien, viewer) => {
    getViewer.mockResolvedValue(viewer);
    const supabase = fakeSupabase();
    createClient.mockResolvedValue(supabase.client);
    const result = await deactivateTutor(TUTOR, {}, form({ reason: "Denuncia" }));
    expect(result.error).toMatch(/No tenés permiso/);
    expect(supabase.client.rpc).not.toHaveBeenCalled();
  });

  it("exige un motivo y conserva lo escrito", async () => {
    const supabase = asAdmin();
    const result = await deactivateTutor(TUTOR, {}, form({ reason: "" }));
    expect(result.fieldErrors?.reason?.length).toBeGreaterThan(0);
    expect(supabase.client.rpc).not.toHaveBeenCalled();
  });

  it("un motivo de más de 500 caracteres no se manda", async () => {
    const result = await (asAdmin(), deactivateTutor(TUTOR, {}, form({ reason: "x".repeat(501) })));
    expect(result.fieldErrors?.reason?.length).toBeGreaterThan(0);
  });

  it("da de baja con el motivo y lleva a la lista de rechazados", async () => {
    const supabase = asAdmin();
    const destino = await catchRedirect(() => deactivateTutor(TUTOR, {}, form({ reason: "Denuncia de un alumno" })));
    expect(supabase.client.rpc).toHaveBeenCalledWith("decide_tutor_profile", {
      p_tutor_id: TUTOR,
      p_action: "dar_de_baja",
      p_reason: "Denuncia de un alumno",
    });
    expect(destino).toBe("/admin/docentes/rechazados");
    expect(scheduleEmailDelivery).toHaveBeenCalledOnce();
  });

  it("si la base falla, no muestra el detalle", async () => {
    asAdmin({ error: { message: "boom" } });
    const result = await deactivateTutor(TUTOR, {}, form({ reason: "Denuncia" }));
    expect(result.error).toBe("No se pudo dar de baja el perfil. Intentá de nuevo.");
    expect(result.values).toEqual({ reason: "Denuncia" });
  });
});

describe("reopenTutor", () => {
  it("no deja reabrir a quien no es administración", async () => {
    getViewer.mockResolvedValue({ id: "a1", name: "A", role: "alumno" });
    const supabase = fakeSupabase();
    createClient.mockResolvedValue(supabase.client);
    const result = await reopenTutor(TUTOR, {}, form({ note: "" }));
    expect(result.error).toMatch(/No tenés permiso/);
    expect(supabase.client.rpc).not.toHaveBeenCalled();
  });

  it("la nota es opcional: sin nota manda null y vuelve a la cola", async () => {
    const supabase = asAdmin();
    const destino = await catchRedirect(() => reopenTutor(TUTOR, {}, form({ note: "   " })));
    expect(supabase.client.rpc).toHaveBeenCalledWith("decide_tutor_profile", { p_tutor_id: TUTOR, p_action: "reabrir", p_reason: null });
    expect(destino).toBe("/admin/docentes/pendientes");
    expect(scheduleEmailDelivery).toHaveBeenCalledOnce();
  });

  it("con nota, la manda para el registro", async () => {
    const supabase = asAdmin();
    await catchRedirect(() => reopenTutor(TUTOR, {}, form({ note: "Mandó el título por mail" })));
    expect(supabase.client.rpc).toHaveBeenCalledWith("decide_tutor_profile", {
      p_tutor_id: TUTOR,
      p_action: "reabrir",
      p_reason: "Mandó el título por mail",
    });
  });

  it("si el perfil ya no estaba rechazado, lo dice", async () => {
    asAdmin({ error: { message: "x", hint: "invalid_transition" } });
    const result = await reopenTutor(TUTOR, {}, form({ note: "" }));
    expect(result.error).toMatch(/cambió mientras lo revisabas/);
  });
});
