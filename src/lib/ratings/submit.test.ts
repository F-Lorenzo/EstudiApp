import { describe, expect, it } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";
import { ratingSchema } from "@/lib/validation/rating";
import { ratingErrorMessage, submitRating } from "./submit";

const BOOKING = "b0000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-10-25T12:00:00.000Z");

const booking = (overrides: Record<string, unknown> = {}) => ({
  id: BOOKING,
  student_id: "a1",
  tutor_id: "d1",
  status: "completada",
  ends_at: "2026-10-24T14:00:00.000Z",
  ratings: [],
  ...overrides,
});

function setup(row: unknown, insert: { error?: unknown } = {}) {
  // La inserción en «ratings» se resuelve con el error configurado (o sin error).
  const fake = fakeSupabase({ tables: { bookings: { data: row }, ratings: { error: insert.error ?? null } } });
  const run = (rating = { score: 5, comment: "Muy clara" }, bookingId = BOOKING) =>
    submitRating(fake.client as never, { bookingId, studentId: "a1", rating, now: NOW });
  return { run, fake };
}

describe("submitRating", () => {
  it("guarda la calificación con el docente de la reserva, no uno elegido", async () => {
    const { run, fake } = setup(booking());
    expect(await run()).toEqual({ ok: true, tutorId: "d1" });
    const [insert] = fake.on("ratings")[0].calls;
    expect(insert).toEqual([
      "insert",
      [{ booking_id: BOOKING, student_id: "a1", tutor_id: "d1", score: 5, comment: "Muy clara" }],
    ]);
  });

  it("no califica la clase de otro alumno", async () => {
    const { run, fake } = setup(booking({ student_id: "a2" }));
    expect(await run()).toEqual({ ok: false, reason: "not_found" });
    expect(fake.on("ratings")).toHaveLength(0);
  });

  it("no califica una clase que no terminó", async () => {
    const { run } = setup(booking({ status: "confirmada" }));
    expect(await run()).toEqual({ ok: false, reason: "not_completed" });
  });

  it("no califica después de 30 días", async () => {
    const { run } = setup(booking({ ends_at: "2026-09-24T14:00:00.000Z" }));
    expect(await run()).toEqual({ ok: false, reason: "expired" });
  });

  it("no califica dos veces", async () => {
    const { run, fake } = setup(booking({ ratings: [{ score: 3 }] }));
    expect(await run()).toEqual({ ok: false, reason: "already_rated" });
    expect(fake.on("ratings")).toHaveLength(0);
  });

  it("si la base ya tenía una (doble clic), lo dice", async () => {
    const { run } = setup(booking(), { error: { code: "23505" } });
    expect(await run()).toEqual({ ok: false, reason: "already_rated" });
  });

  it("un id que no es de reserva no consulta nada", async () => {
    const { run, fake } = setup(booking());
    expect(await run(undefined, "nada")).toEqual({ ok: false, reason: "not_found" });
    expect(fake.client.from).not.toHaveBeenCalled();
  });

  it("cada motivo tiene su mensaje", () => {
    expect(ratingErrorMessage("already_rated")).toBe("Ya calificaste esta clase.");
    expect(ratingErrorMessage("error")).toMatch(/Probá de nuevo/);
  });
});

describe("ratingSchema", () => {
  it("acepta de 1 a 5 estrellas y limpia el comentario", () => {
    expect(ratingSchema.parse({ score: "4", comment: "  Bien  " })).toEqual({ score: 4, comment: "Bien" });
    expect(ratingSchema.parse({ score: "5", comment: "   " })).toEqual({ score: 5, comment: null });
    expect(ratingSchema.parse({ score: "5" })).toEqual({ score: 5, comment: null });
  });

  it.each(["0", "6", "3.5", "", "x"])("rechaza la puntuación «%s»", (score) => {
    expect(ratingSchema.safeParse({ score }).success).toBe(false);
  });

  it("rechaza un comentario de más de 600 caracteres", () => {
    expect(ratingSchema.safeParse({ score: 5, comment: "x".repeat(601) }).success).toBe(false);
  });
});
