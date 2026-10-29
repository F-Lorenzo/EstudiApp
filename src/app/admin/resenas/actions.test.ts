import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";
import { decideAppeal } from "./actions";

const revalidatePath = vi.hoisted(() => vi.fn());
const createClient = vi.hoisted(() => vi.fn());
const getViewer = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/auth/viewer", () => ({ getViewer }));

const ADMIN = { id: "ad", name: "Admin", role: "administrador" };

function form(response?: string) {
  const data = new FormData();
  if (response !== undefined) data.set("response", response);
  return data;
}

function asAdmin(result: { data?: unknown; error?: unknown } = { data: "aceptada" }) {
  getViewer.mockResolvedValue(ADMIN);
  const supabase = fakeSupabase({ rpc: { decide_rating_appeal: result } });
  createClient.mockResolvedValue(supabase.client);
  return supabase;
}

beforeEach(() => {
  for (const mock of [revalidatePath, createClient, getViewer]) mock.mockReset();
});

describe("decideAppeal", () => {
  it("acepta sin respuesta y actualiza el docente, el registro y la comisión", async () => {
    const supabase = asAdmin();
    expect(await decideAppeal("a1", true, {}, form(""))).toEqual({ success: true });
    expect(supabase.client.rpc).toHaveBeenCalledWith("decide_rating_appeal", { p_appeal: "a1", p_accept: true, p_response: null });
    for (const path of ["/admin/resenas", "/admin/registro", "/admin/comision", "/docente/resenas"]) {
      expect(revalidatePath).toHaveBeenCalledWith(path);
    }
  });

  it("rechazar pide una respuesta", async () => {
    const supabase = asAdmin();
    const result = await decideAppeal("a1", false, {}, form("  "));
    expect(result.fieldErrors?.response?.length).toBeGreaterThan(0);
    expect(supabase.client.rpc).not.toHaveBeenCalled();

    expect(await decideAppeal("a1", false, {}, form(" La reseña describe la clase. "))).toEqual({ success: true });
    expect(supabase.client.rpc).toHaveBeenCalledWith("decide_rating_appeal", {
      p_appeal: "a1",
      p_accept: false,
      p_response: "La reseña describe la clase.",
    });
  });

  it("solo la administración decide", async () => {
    getViewer.mockResolvedValue({ id: "d1", name: "D", role: "docente" });
    expect((await decideAppeal("a1", true, {}, form())).error).toMatch(/No tenés permiso/);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("una apelación ya decidida lo avisa y refresca la lista", async () => {
    asAdmin({ error: { hint: "already_decided", message: "x" } });
    expect((await decideAppeal("a1", true, {}, form())).error).toMatch(/ya se decidió/);
    expect(revalidatePath).toHaveBeenCalledWith("/admin/resenas");
  });
});
