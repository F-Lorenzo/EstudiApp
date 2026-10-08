import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";
import { saveAvailability } from "./actions";

const revalidatePath = vi.hoisted(() => vi.fn());
const createClient = vi.hoisted(() => vi.fn());
const getViewer = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/auth/viewer", () => ({ getViewer }));

const DOCENTE = { id: "d1", name: "Docente", role: "docente" };

// «Ahora» fijo: miércoles 7 de octubre de 2026, 12:00 en Argentina (15:00 UTC).
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-07T15:00:00.000Z"));
  for (const mock of [revalidatePath, createClient, getViewer]) mock.mockReset();
  getViewer.mockResolvedValue(DOCENTE);
});
afterEach(() => vi.useRealTimers());

describe("saveAvailability", () => {
  it("rechaza un pedido que no tiene la forma esperada", async () => {
    const result = await saveAvailability({ open: "no es una lista" });
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/No pudimos leer/) });
  });

  it("rechaza demasiados cambios de una vez", async () => {
    const muchas = Array.from({ length: 301 }, (_, i) => `2026-10-${String(8 + (i % 20)).padStart(2, "0")}T10`);
    expect((await saveAvailability({ open: muchas, close: [] })).ok).toBe(false);
  });

  it("sin sesión no guarda nada", async () => {
    getViewer.mockResolvedValue(null);
    const supabase = fakeSupabase();
    createClient.mockResolvedValue(supabase.client);

    const result = await saveAvailability({ open: ["2026-10-08T10"], close: [] });

    expect(result).toEqual({ ok: false, error: expect.stringMatching(/sesión expiró/) });
    expect(supabase.client.from).not.toHaveBeenCalled();
  });

  it.each(["alumno", "administrador"])("un %s no puede administrar disponibilidad", async (role) => {
    getViewer.mockResolvedValue({ id: "x", name: "X", role });
    const supabase = fakeSupabase();
    createClient.mockResolvedValue(supabase.client);

    const result = await saveAvailability({ open: ["2026-10-08T10"], close: [] });

    expect(result).toEqual({ ok: false, error: expect.stringMatching(/Solo los docentes/) });
    expect(supabase.client.from).not.toHaveBeenCalled();
  });

  it.each([
    ["una hora que ya pasó", "2026-10-07T11"],
    ["fuera del horario permitido", "2026-10-08T22"],
    ["demasiado lejos", "2027-06-01T10"],
    ["una clave inválida", "basura"],
  ])("no abre %s", async (_motivo, clave) => {
    const supabase = fakeSupabase();
    createClient.mockResolvedValue(supabase.client);

    expect((await saveAvailability({ open: [clave], close: [] })).ok).toBe(false);
    expect(supabase.client.from).not.toHaveBeenCalled();
  });

  it("cerrar solo borra franjas LIBRES del propio docente", async () => {
    const supabase = fakeSupabase({ tables: { availability_slots: { data: [{ id: "s1" }] } } });
    createClient.mockResolvedValue(supabase.client);

    const result = await saveAvailability({ open: [], close: ["2026-10-09T10"] });

    expect(result).toMatchObject({ ok: true, closed: 1 });
    const [borrado] = supabase.on("availability_slots");
    expect(borrado.calls).toContainEqual(["delete", []]);
    expect(borrado.calls).toContainEqual(["eq", ["tutor_id", DOCENTE.id]]);
    expect(borrado.calls).toContainEqual(["eq", ["is_booked", false]]);
    // 10:00 en Argentina son las 13:00 UTC.
    expect(borrado.calls).toContainEqual(["in", ["starts_at", ["2026-10-09T13:00:00.000Z"]]]);
  });

  it("lo que se pide abrir y cerrar a la vez queda como estaba", async () => {
    const supabase = fakeSupabase({ tables: { availability_slots: { data: [] } } });
    createClient.mockResolvedValue(supabase.client);

    await saveAvailability({ open: ["2026-10-09T10"], close: ["2026-10-09T10"] });

    const borrados = supabase.on("availability_slots").filter((q) => q.calls.some(([m]) => m === "delete"));
    expect(borrados).toHaveLength(0);
  });

  it("si la base falla al cerrar, no muestra el detalle", async () => {
    createClient.mockResolvedValue(
      fakeSupabase({ tables: { availability_slots: { error: { message: "permission denied for table" } } } }).client,
    );

    const result = await saveAvailability({ open: [], close: ["2026-10-09T10"] });

    expect(result).toEqual({ ok: false, error: expect.stringMatching(/No pudimos cerrar/) });
    expect(JSON.stringify(result)).not.toContain("permission denied");
  });
});
