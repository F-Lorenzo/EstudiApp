import { describe, expect, it } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";
import {
  appealErrorMessage,
  decisionErrorMessage,
  getAdminAppeals,
  getMyLevel,
  getMyReviews,
  missingForNext,
} from "./appeals";

const NOW = new Date("2026-10-28T15:00:00.000Z");

describe("getMyLevel", () => {
  it("traduce el nivel del docente, con el siguiente", async () => {
    const { client } = fakeSupabase({
      rpc: {
        my_commission_level: {
          data: {
            enabled: true,
            level_name: "Gran profesor",
            rate: "0.1000",
            reviews: 12,
            average: "4.62",
            next: { name: "Maestro", min_reviews: 25, min_rating: "4.70", rate: "0.0800" },
          },
        },
      },
    });
    expect(await getMyLevel(client as never)).toEqual({
      enabled: true,
      name: "Gran profesor",
      rate: 0.1,
      reviews: 12,
      average: 4.62,
      next: { name: "Maestro", minReviews: 25, minRating: 4.7, rate: 0.08 },
    });
  });

  it("en el nivel más alto no hay siguiente; si la base falla, null", async () => {
    const top = fakeSupabase({
      rpc: { my_commission_level: { data: { enabled: false, level_name: "Gran maestro", rate: 0.12, reviews: 60, average: 4.9, next: null } } },
    });
    expect((await getMyLevel(top.client as never))?.next).toBeNull();
    const broken = fakeSupabase({ rpc: { my_commission_level: { error: { message: "x" } } } });
    expect(await getMyLevel(broken.client as never)).toBeNull();
  });
});

describe("missingForNext", () => {
  const next = { name: "Maestro", minReviews: 25, minRating: 4.7, rate: 0.08 };
  it("dice cuántas reseñas faltan y qué promedio", () => {
    expect(missingForNext({ reviews: 12, average: 4.6, next })).toEqual(["13 reseñas más", "un promedio de 4,7 o más"]);
    expect(missingForNext({ reviews: 24, average: 4.8, next })).toEqual(["1 reseña más"]);
    expect(missingForNext({ reviews: 0, average: null, next })).toEqual(["25 reseñas más", "un promedio de 4,7 o más"]);
  });
  it("sin siguiente nivel, nada", () => {
    expect(missingForNext({ reviews: 60, average: 4.9, next: null })).toEqual([]);
  });
});

const review = {
  rating_id: "r1",
  score: 2,
  comment: "Llegó tarde",
  created_at: "2026-10-25T15:00:00.000Z",
  class_starts_at: "2026-10-24T15:00:00.000Z",
  author_name: "Sofía G.",
  removed: false,
  appeal_id: null,
  appeal_status: null,
  appeal_reason: null,
  appeal_response: null,
  appeal_created_at: null,
  appeal_decided_at: null,
};

describe("getMyReviews", () => {
  it("ofrece apelar solo las de 1 o 2 estrellas sin apelación", async () => {
    const { client } = fakeSupabase({
      rpc: {
        my_reviews: {
          data: [
            review,
            { ...review, rating_id: "r2", score: 3 },
            { ...review, rating_id: "r3", appeal_id: "a1", appeal_status: "pendiente", appeal_reason: "No vino", appeal_created_at: review.created_at },
            {
              ...review,
              rating_id: "r4",
              score: 1,
              removed: true,
              appeal_id: "a2",
              appeal_status: "aceptada",
              appeal_reason: "No vino",
              appeal_decided_at: "2026-10-27T15:00:00.000Z",
            },
          ],
        },
      },
    });
    const { reviews, error } = await getMyReviews(client as never, { now: NOW });
    expect(error).toBe(false);
    expect(reviews.map((r) => [r.ratingId, r.canAppeal])).toEqual([["r1", true], ["r2", false], ["r3", false], ["r4", false]]);
    expect(reviews[0]).toMatchObject({ author: "Sofía G.", ago: "hace 3 días", appeal: null, removed: false });
    expect(reviews[3]).toMatchObject({ removed: true, appeal: { status: "aceptada", reason: "No vino", decidedAgo: "ayer" } });
  });

  it("si la base falla, lo dice", async () => {
    const { client } = fakeSupabase({ rpc: { my_reviews: { error: { message: "x" } } } });
    expect(await getMyReviews(client as never)).toEqual({ reviews: [], error: true });
  });
});

describe("getAdminAppeals", () => {
  it("traduce cada apelación con los nombres de las dos partes", async () => {
    const { client } = fakeSupabase({
      rpc: {
        admin_rating_appeals: {
          data: [
            {
              appeal_id: "a1",
              status: "pendiente",
              tutor_id: "d1",
              tutor_name: "Martín López",
              student_name: null,
              score: 1,
              comment: null,
              rated_at: review.created_at,
              class_starts_at: review.class_starts_at,
              reason: "No vino a la clase",
              response: null,
              created_at: "2026-10-27T15:00:00.000Z",
              decided_at: null,
              decided_by_name: null,
            },
          ],
        },
      },
    });
    const { appeals } = await getAdminAppeals(client as never, { now: NOW });
    expect(appeals).toEqual([
      expect.objectContaining({ id: "a1", tutorName: "Martín López", studentName: "Estudiante", score: 1, ago: "ayer", decidedAgo: null }),
    ]);
  });
});

describe("mensajes", () => {
  it("cada motivo de la base tiene su mensaje, y lo desconocido uno genérico", () => {
    expect(appealErrorMessage("already_appealed")).toBe("Ya apelaste esta reseña.");
    expect(appealErrorMessage("not_appealable")).toMatch(/1 o 2 estrellas/);
    expect(appealErrorMessage(undefined)).toMatch(/No pudimos enviar/);
    expect(decisionErrorMessage("response_required")).toMatch(/respuesta/);
    expect(decisionErrorMessage("already_decided")).toMatch(/ya se decidió/);
    expect(decisionErrorMessage("x")).toMatch(/No pudimos guardar/);
  });
});
