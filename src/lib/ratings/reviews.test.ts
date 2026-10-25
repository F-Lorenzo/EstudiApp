import { describe, expect, it } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";
import { canRate } from "./window";
import { getTutorReviews } from "./reviews";

describe("getTutorReviews", () => {
  it("arma las opiniones con autor, fecha relativa y el total", async () => {
    const fake = fakeSupabase({
      rpc: {
        tutor_reviews: {
          data: [
            { score: 5, comment: "Excelente", created_at: "2026-10-22T15:00:00.000Z", author_name: "Tomás R.", review_count: 7 },
            { score: 4, comment: null, created_at: "2026-08-01T15:00:00.000Z", author_name: "Estudiante", review_count: 7 },
          ],
        },
      },
    });
    const result = await getTutorReviews(fake.client as never, "d1", { now: new Date("2026-10-25T12:00:00.000Z") });
    expect(fake.client.rpc).toHaveBeenCalledWith("tutor_reviews", { p_tutor_id: "d1", p_limit: 50 });
    expect(result.total).toBe(7);
    expect(result.reviews).toEqual([
      { score: 5, comment: "Excelente", author: "Tomás R.", createdAt: "2026-10-22T15:00:00.000Z", ago: "hace 3 días" },
      { score: 4, comment: null, author: "Estudiante", createdAt: "2026-08-01T15:00:00.000Z", ago: "hace 2 meses" },
    ]);
  });

  it("si la consulta falla, no muestra opiniones", async () => {
    const fake = fakeSupabase({ rpc: { tutor_reviews: { error: { message: "x" } } } });
    expect(await getTutorReviews(fake.client as never, "d1")).toEqual({ reviews: [], total: 0 });
  });
});

describe("canRate", () => {
  const now = new Date("2026-10-25T12:00:00.000Z");
  it("solo una clase completada, sin calificar y de los últimos 30 días", () => {
    expect(canRate({ status: "completada", endsAt: "2026-10-24T14:00:00.000Z", score: null }, now)).toBe(true);
    expect(canRate({ status: "completada", endsAt: "2026-10-24T14:00:00.000Z", score: 5 }, now)).toBe(false);
    expect(canRate({ status: "confirmada", endsAt: "2026-10-24T14:00:00.000Z", score: null }, now)).toBe(false);
    expect(canRate({ status: "completada", endsAt: "2026-09-25T12:00:00.000Z", score: null }, now)).toBe(false);
    expect(canRate({ status: "completada", endsAt: "2026-09-25T12:00:01.000Z", score: null }, now)).toBe(true);
  });
});
