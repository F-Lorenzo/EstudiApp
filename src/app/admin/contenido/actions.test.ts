import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";
import { saveSiteContent } from "./actions";

const revalidatePath = vi.hoisted(() => vi.fn());
const createClient = vi.hoisted(() => vi.fn());
const getViewer = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/auth/viewer", () => ({ getViewer }));

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  for (const mock of [revalidatePath, createClient, getViewer]) mock.mockReset();
});

describe("saveSiteContent", () => {
  it("no deja cambiar el contenido a quien no es administración", async () => {
    getViewer.mockResolvedValue({ id: "a1", name: "A", role: "alumno" });
    const supabase = fakeSupabase();
    createClient.mockResolvedValue(supabase.client);
    expect((await saveSiteContent({}, form({ heroTitle: "x" }))).error).toMatch(/No tenés permiso/);
    expect(supabase.client.from).not.toHaveBeenCalled();
  });

  it("publica el hero y el anuncio, y actualiza el inicio", async () => {
    getViewer.mockResolvedValue({ id: "ad", name: "Admin", role: "administrador" });
    const supabase = fakeSupabase({ tables: { site_content: { data: [{ id: true }] } } });
    createClient.mockResolvedValue(supabase.client);
    const result = await saveSiteContent(
      {},
      form({
        heroTitle: "Aprender\ncambia todo.",
        heroHighlight: "",
        heroDescription: "",
        announcementEnabled: "on",
        announcementText: "Inscripciones abiertas",
        announcementLinkLabel: "Ver docentes",
        announcementLinkUrl: "/docentes",
        announcementEndsAt: "2026-11-30",
      }),
    );
    expect(result).toEqual({ success: true });
    const [query] = supabase.on("site_content");
    expect(query.calls).toContainEqual([
      "update",
      [
        {
          hero_title: "Aprender\ncambia todo.",
          hero_highlight: null,
          hero_description: null,
          announcement_enabled: true,
          announcement_text: "Inscripciones abiertas",
          announcement_link_label: "Ver docentes",
          announcement_link_url: "/docentes",
          announcement_ends_at: "2026-11-30T23:59:59-03:00",
        },
      ],
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  it("un enlace inseguro no se manda y conserva lo escrito", async () => {
    getViewer.mockResolvedValue({ id: "ad", name: "Admin", role: "administrador" });
    const supabase = fakeSupabase();
    createClient.mockResolvedValue(supabase.client);
    const result = await saveSiteContent({}, form({ announcementText: "Hola", announcementLinkLabel: "Ver", announcementLinkUrl: "javascript:alert(1)" }));
    expect(result.fieldErrors?.announcementLinkUrl?.length).toBeGreaterThan(0);
    expect(result.values?.announcementLinkUrl).toBe("javascript:alert(1)");
    expect(supabase.client.from).not.toHaveBeenCalled();
  });

  it("si la base no guarda, avisa sin el detalle", async () => {
    getViewer.mockResolvedValue({ id: "ad", name: "Admin", role: "administrador" });
    createClient.mockResolvedValue(fakeSupabase({ tables: { site_content: { error: { message: "check violation" } } } }).client);
    const result = await saveSiteContent({}, form({ heroTitle: "Hola" }));
    expect(result.error).toBe("No se pudo publicar el contenido. Intentá de nuevo.");
  });
});
