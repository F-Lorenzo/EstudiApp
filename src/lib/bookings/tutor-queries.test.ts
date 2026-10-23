import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";
import { STUDENT_FALLBACK_NAME, getTutorClasses } from "./tutor-queries";

vi.mock("@/lib/bookings/sync", () => ({ syncBookings: vi.fn() }));

const row = (overrides: Record<string, unknown>) => ({
  id: "b1",
  starts_at: "2026-10-24T13:00:00.000Z",
  ends_at: "2026-10-24T14:00:00.000Z",
  ratings: null,
  profiles: { full_name: "Sofía Martínez", avatar_url: "https://example.com/sofia.png" },
  ...overrides,
});

async function classesFrom(rows: unknown[]) {
  const supabase = fakeSupabase({ tables: { bookings: { data: rows } } });
  const result = await getTutorClasses(supabase.client as unknown as SupabaseClient, "d1", "confirmada");
  return { result, query: supabase.on("bookings")[0] };
}

describe("clases del docente", () => {
  it("pide el nombre y la foto del alumno, y nada más de su perfil", async () => {
    const { query } = await classesFrom([]);
    expect(query.calls[0]).toEqual(["select", ["id, starts_at, ends_at, ratings(score), profiles(full_name, avatar_url)"]]);
  });

  it("devuelve el nombre y la foto del alumno", async () => {
    const { result } = await classesFrom([row({})]);
    expect(result.classes[0]).toMatchObject({ studentName: "Sofía Martínez", studentPhoto: "https://example.com/sofia.png" });
  });

  it("si el alumno no cargó su nombre (o la base no lo devolvió) muestra «Estudiante»", async () => {
    const { result } = await classesFrom([
      row({ id: "a", profiles: { full_name: "  ", avatar_url: null } }),
      row({ id: "b", starts_at: "2026-10-25T13:00:00.000Z", profiles: null }),
      row({ id: "c", starts_at: "2026-10-26T13:00:00.000Z", profiles: [{ full_name: "Tomás", avatar_url: "" }] }),
    ]);
    expect(result.classes.map((c) => [c.studentName, c.studentPhoto])).toEqual([
      [STUDENT_FALLBACK_NAME, null],
      [STUDENT_FALLBACK_NAME, null],
      ["Tomás", null],
    ]);
  });

  it("ordena las próximas de la más cercana a la más lejana", async () => {
    const { result } = await classesFrom([row({ id: "tarde", starts_at: "2026-10-30T13:00:00.000Z" }), row({ id: "pronto" })]);
    expect(result.classes.map((c) => c.id)).toEqual(["pronto", "tarde"]);
  });
});
