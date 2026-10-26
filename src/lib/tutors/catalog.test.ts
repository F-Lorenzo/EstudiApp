import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { CATALOG_PAGE_SIZE, searchTutorCatalog } from "./catalog";

function fakeSupabase(response: { data: unknown; error: unknown }) {
  const calls: { fn: string; args: unknown }[] = [];
  const client = {
    rpc: async (fn: string, args?: unknown) => {
      calls.push({ fn, args });
      return fn === "search_tutor_catalog" ? response : { data: null, error: null };
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const row = {
  id: "d1",
  full_name: "José Núñez",
  avatar_url: null,
  bio: "Bio",
  tarifa_por_clase: "8000.00",
  rating_promedio: 4.5,
  subject_names: ["Física"],
  has_availability: true,
};

describe("searchTutorCatalog", () => {
  it("le pide a la base la página con los filtros", async () => {
    const { client, calls } = fakeSupabase({ data: { total: 23, rows: [row] }, error: null });
    await searchTutorCatalog(client, {
      q: "  física  ",
      materias: ["Física"],
      precioMax: 12000,
      disponibilidad: true,
      orden: "precio",
      pagina: 3,
    });
    // Antes pone al día las reservas vencidas, para que «con horarios» no cuente horarios retenidos.
    expect(calls.map((call) => call.fn)).toEqual(["sync_bookings", "search_tutor_catalog"]);
    expect(calls[1].args).toEqual({
      p_q: "física",
      p_materias: ["Física"],
      p_precio_min: null,
      p_precio_max: 12000,
      p_disponibilidad: true,
      p_orden: "precio",
      p_limit: CATALOG_PAGE_SIZE,
      p_offset: 2 * CATALOG_PAGE_SIZE,
    });
  });

  it("sin filtros manda nulos y la primera página", async () => {
    const { client, calls } = fakeSupabase({ data: { total: 0, rows: [] }, error: null });
    await searchTutorCatalog(client, { q: "   ", materias: [], pagina: 0 });
    expect(calls[1].args).toMatchObject({ p_q: null, p_materias: null, p_disponibilidad: false, p_orden: "calificacion", p_offset: 0 });
  });

  it("devuelve el total y las filas con los números ya convertidos", async () => {
    const { client } = fakeSupabase({ data: { total: "23", rows: [row] }, error: null });
    const { data, error } = await searchTutorCatalog(client, {});
    expect(error).toBeNull();
    expect(data).toEqual({ total: 23, rows: [{ ...row, tarifa_por_clase: 8000 }] });
  });

  it("un error de la base o una respuesta con otra forma es un error", async () => {
    const failing = fakeSupabase({ data: null, error: { message: "boom" } });
    expect(await searchTutorCatalog(failing.client, {})).toEqual({ data: null, error: { message: "boom" } });
    const odd = fakeSupabase({ data: [row], error: null });
    const result = await searchTutorCatalog(odd.client, {});
    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
  });
});
