import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";
import { getCompletedClasses, getUpcomingClasses, hasEnded } from "./queries";

vi.mock("@/lib/bookings/sync", () => ({ syncBookings: vi.fn() }));

const HOUR = 3_600_000;
const row = (id: string, status: string, endsInHours: number) => ({
  id,
  status,
  tutor_id: "d1",
  price: 10000,
  created_at: new Date(Date.now() - 48 * HOUR).toISOString(),
  starts_at: new Date(Date.now() + (endsInHours - 1) * HOUR).toISOString(),
  ends_at: new Date(Date.now() + endsInHours * HOUR).toISOString(),
  tutor_profiles: { profiles: { full_name: "María González", avatar_url: null } },
  ratings: null,
});

const client = (rows: unknown[]) => fakeSupabase({ tables: { bookings: { data: rows } } }).client as unknown as SupabaseClient;

describe("clases del alumno según la asistencia", () => {
  it("una confirmada que ya terminó no está entre las próximas", async () => {
    const { classes } = await getUpcomingClasses(client([row("termino", "confirmada", -1), row("despues", "confirmada", 5), row("en-curso", "confirmada", 0.5)]), "a1");
    expect(classes.map((c) => c.id)).toEqual(["en-curso", "despues"]);
  });

  it("va al historial, junto con las completadas", async () => {
    const { classes } = await getCompletedClasses(client([row("termino", "confirmada", -1), row("vieja", "completada", -48), row("futura", "confirmada", 5)]), "a1");
    expect(classes.map((c) => [c.id, c.status])).toEqual([["termino", "confirmada"], ["vieja", "completada"]]);
  });

  it("hasEnded: solo una confirmada cuyo horario terminó", () => {
    const now = Date.parse("2026-10-24T14:00:00.000Z");
    expect(hasEnded({ status: "confirmada", endsAt: "2026-10-24T14:00:00.000Z" }, now)).toBe(true);
    expect(hasEnded({ status: "confirmada", endsAt: "2026-10-24T14:00:01.000Z" }, now)).toBe(false);
    expect(hasEnded({ status: "completada", endsAt: "2026-10-24T13:00:00.000Z" }, now)).toBe(false);
  });
});
