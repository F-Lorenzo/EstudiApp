import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";
import { deleteCommissionTier, saveCommissionSettings, saveCommissionTier } from "./actions";

const revalidatePath = vi.hoisted(() => vi.fn());
const createClient = vi.hoisted(() => vi.fn());
const getViewer = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/auth/viewer", () => ({ getViewer }));

const ADMIN = { id: "ad", name: "Admin", role: "administrador" };

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

function asAdmin(tables: Record<string, { data?: unknown; error?: unknown }> = {}) {
  getViewer.mockResolvedValue(ADMIN);
  const supabase = fakeSupabase({
    tables: { commission_settings: { data: [{ id: true }] }, commission_tiers: { data: [{ id: "t1" }] }, ...tables },
  });
  createClient.mockResolvedValue(supabase.client);
  return supabase;
}

beforeEach(() => {
  for (const mock of [revalidatePath, createClient, getViewer]) mock.mockReset();
});

describe("saveCommissionSettings", () => {
  it("no deja cambiar la comisión a quien no es administración", async () => {
    getViewer.mockResolvedValue({ id: "d1", name: "D", role: "docente" });
    const supabase = fakeSupabase();
    createClient.mockResolvedValue(supabase.client);
    const result = await saveCommissionSettings({}, form({ enabled: "on", base: "12", floor: "6" }));
    expect(result.error).toMatch(/No tenés permiso/);
    expect(supabase.client.from).not.toHaveBeenCalled();
  });

  it("guarda el interruptor y las tasas", async () => {
    const supabase = asAdmin();
    const result = await saveCommissionSettings({}, form({ enabled: "on", base: "12", floor: "6,5" }));
    expect(result).toEqual({ success: true });
    const [query] = supabase.on("commission_settings");
    expect(query.calls).toContainEqual(["update", [{ enabled: true, base_rate: 0.12, floor_rate: 0.065 }]]);
    expect(revalidatePath).toHaveBeenCalledWith("/admin/registro");
  });

  it("sin la casilla, la apaga", async () => {
    const supabase = asAdmin();
    await saveCommissionSettings({}, form({ base: "12", floor: "6" }));
    const [query] = supabase.on("commission_settings");
    expect(query.calls).toContainEqual(["update", [{ enabled: false, base_rate: 0.12, floor_rate: 0.06 }]]);
  });

  it("un piso mayor que la base no se manda", async () => {
    const supabase = asAdmin();
    const result = await saveCommissionSettings({}, form({ base: "8", floor: "10" }));
    expect(result.fieldErrors?.floor?.length).toBeGreaterThan(0);
    expect(supabase.client.from).not.toHaveBeenCalled();
  });

  it("si la base no actualiza nada (la RLS lo filtró), avisa", async () => {
    asAdmin({ commission_settings: { data: [] } });
    const result = await saveCommissionSettings({}, form({ base: "12", floor: "6" }));
    expect(result.error).toMatch(/No se pudo guardar/);
  });
});

describe("escalones", () => {
  it("crea un escalón nuevo", async () => {
    const supabase = asAdmin();
    const result = await saveCommissionTier(null, {}, form({ minReviews: "10", minRating: "4,5", rate: "10", active: "on" }));
    expect(result).toEqual({ success: true });
    const [query] = supabase.on("commission_tiers");
    expect(query.calls).toContainEqual(["insert", [{ min_reviews: 10, min_rating: 4.5, rate: 0.1, active: true }]]);
  });

  it("cambia uno existente", async () => {
    const supabase = asAdmin();
    await saveCommissionTier("t1", {}, form({ minReviews: "25", minRating: "4.7", rate: "8" }));
    const [query] = supabase.on("commission_tiers");
    expect(query.calls).toContainEqual(["update", [{ min_reviews: 25, min_rating: 4.7, rate: 0.08, active: false }]]);
    expect(query.calls).toContainEqual(["eq", ["id", "t1"]]);
  });

  it("un escalón inválido conserva lo escrito", async () => {
    asAdmin();
    const result = await saveCommissionTier(null, {}, form({ minReviews: "0", minRating: "4", rate: "10" }));
    expect(result.fieldErrors?.minReviews?.length).toBeGreaterThan(0);
    expect(result.values).toEqual({ minReviews: "0", minRating: "4", rate: "10" });
  });

  it("borra un escalón; si la base falla, lo dice sin el detalle", async () => {
    const supabase = asAdmin();
    expect(await deleteCommissionTier("t1")).toEqual({ success: true });
    const [query] = supabase.on("commission_tiers");
    expect(query.calls).toContainEqual(["eq", ["id", "t1"]]);

    asAdmin({ commission_tiers: { error: { message: "permission denied" } } });
    const failed = await deleteCommissionTier("t1");
    expect(failed.error).toBe("No se pudo borrar el escalón. Intentá de nuevo.");
  });

  it("no deja borrar a quien no es administración", async () => {
    getViewer.mockResolvedValue(null);
    expect((await deleteCommissionTier("t1")).error).toMatch(/No tenés permiso/);
  });
});
