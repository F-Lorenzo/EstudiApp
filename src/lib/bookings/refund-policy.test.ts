import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { refundAmount, refundExplanation, refundPercent } from "./refund-policy";

type Caso = { caso: string; minutesBefore: number; tutorOrAdmin: boolean; percent: number };

// La misma tabla la usa la prueba de la base de datos con la función SQL `refund_percent()`.
const CASOS: Caso[] = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../../supabase/tests/fixtures/refund-policy-cases.json"), "utf8"),
);

describe("política de reembolsos (espejo de refund_percent en SQL)", () => {
  const empieza = new Date("2026-12-01T15:00:00.000Z");

  it.each(CASOS)("$caso → $percent %", ({ minutesBefore, tutorOrAdmin, percent }) => {
    const ahora = new Date(empieza.getTime() - minutesBefore * 60_000);
    expect(refundPercent({ startsAt: empieza, at: ahora, tutorOrAdmin })).toBe(percent);
  });

  it("acepta fechas como texto ISO", () => {
    expect(refundPercent({ startsAt: "2026-12-01T15:00:00Z", at: "2026-11-29T15:00:00Z" })).toBe(100);
  });
});

describe("refundAmount", () => {
  it("calcula el monto con centavos", () => {
    expect(refundAmount(10000, 100)).toBe(10000);
    expect(refundAmount(10000, 50)).toBe(5000);
    expect(refundAmount(12500, 50)).toBe(6250);
    expect(refundAmount(8333.33, 50)).toBe(4166.67);
    expect(refundAmount(10000, 0)).toBe(0);
  });
});

describe("refundExplanation", () => {
  it("le dice a la persona cuánto recibe antes de cancelar", () => {
    expect(refundExplanation(100, 12500)).toMatch(/el total \(\$ 12\.500\)/);
    expect(refundExplanation(50, 12500)).toMatch(/50 % \(\$ 6\.250\).*menos de 24 horas/);
    expect(refundExplanation(0, 12500)).toMatch(/no hay reembolso/);
  });

  it("funciona sin precio", () => {
    expect(refundExplanation(100)).toBe("Si cancelás ahora, te devolvemos el total.");
  });
});
