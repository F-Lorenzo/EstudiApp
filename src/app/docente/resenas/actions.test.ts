import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";
import { appealReview } from "./actions";

const revalidatePath = vi.hoisted(() => vi.fn());
const createClient = vi.hoisted(() => vi.fn());
const getViewer = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/auth/viewer", () => ({ getViewer }));

const DOCENTE = { id: "d1", name: "Martín", role: "docente" };
const REASON = "El alumno no se presentó a la clase.";

function form(reason: string) {
  const data = new FormData();
  data.set("reason", reason);
  return data;
}

beforeEach(() => {
  for (const mock of [revalidatePath, createClient, getViewer]) mock.mockReset();
});

describe("appealReview", () => {
  it("manda la apelación con el motivo limpio", async () => {
    getViewer.mockResolvedValue(DOCENTE);
    const supabase = fakeSupabase({ rpc: { appeal_rating: { data: "a1" } } });
    createClient.mockResolvedValue(supabase.client);
    expect(await appealReview("r1", {}, form(`  ${REASON}  `))).toEqual({ success: true });
    expect(supabase.client.rpc).toHaveBeenCalledWith("appeal_rating", { p_rating: "r1", p_reason: REASON });
    expect(revalidatePath).toHaveBeenCalledWith("/docente/resenas");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/resenas");
  });

  it("un motivo corto no se manda", async () => {
    getViewer.mockResolvedValue(DOCENTE);
    const supabase = fakeSupabase();
    createClient.mockResolvedValue(supabase.client);
    const result = await appealReview("r1", {}, form("porque sí"));
    expect(result.fieldErrors?.reason?.length).toBeGreaterThan(0);
    expect(result.values).toEqual({ reason: "porque sí" });
    expect(supabase.client.rpc).not.toHaveBeenCalled();
  });

  it("solo un docente con sesión apela", async () => {
    getViewer.mockResolvedValue(null);
    expect((await appealReview("r1", {}, form(REASON))).error).toMatch(/sesión expiró/);
    getViewer.mockResolvedValue({ id: "a1", name: "A", role: "alumno" });
    expect((await appealReview("r1", {}, form(REASON))).error).toMatch(/Solo el docente/);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("traduce lo que responde la base", async () => {
    getViewer.mockResolvedValue(DOCENTE);
    const supabase = fakeSupabase({ rpc: { appeal_rating: { error: { hint: "already_appealed", message: "x" } } } });
    createClient.mockResolvedValue(supabase.client);
    expect(await appealReview("r1", {}, form(REASON))).toEqual({ error: "Ya apelaste esta reseña.", values: undefined });
  });
});
