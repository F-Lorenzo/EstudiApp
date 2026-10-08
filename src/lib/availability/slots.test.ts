import { describe, expect, it } from "vitest";
import {
  addDays,
  keyFromIso,
  mondayOf,
  openSlotError,
  parseSlotKey,
  slotEnd,
  slotKey,
  slotStart,
  weekDates,
} from "./slots";

describe("claves de franja", () => {
  it("arma y lee una clave", () => {
    expect(slotKey("2026-10-08", 9)).toBe("2026-10-08T09");
    expect(parseSlotKey("2026-10-08T15")).toEqual({ date: "2026-10-08", hour: 15 });
  });

  it.each(["2026-02-31T10", "2026-10-08T24", "2026-10-08T9", "basura", ""])(
    "rechaza la clave inválida %j",
    (clave) => {
      expect(parseSlotKey(clave)).toBeNull();
    },
  );

  it("las 15 h de Argentina son las 18 h UTC (sin horario de verano)", () => {
    expect(slotStart("2026-10-08T15")?.toISOString()).toBe("2026-10-08T18:00:00.000Z");
  });

  it("una franja de las 23 h termina ya en el día siguiente en UTC", () => {
    expect(slotEnd("2026-10-08T23")?.toISOString()).toBe("2026-10-09T03:00:00.000Z");
  });

  it("vuelve de un instante a su clave en hora de Argentina", () => {
    expect(keyFromIso("2026-10-08T18:00:00.000Z")).toBe("2026-10-08T15");
    // Pasada la medianoche UTC todavía es el día anterior en Argentina.
    expect(keyFromIso("2026-10-09T02:30:00.000Z")).toBe("2026-10-08T23");
  });
});

describe("fechas de la semana", () => {
  it("calcula el lunes de cualquier día de la semana", () => {
    expect(mondayOf("2026-10-05")).toBe("2026-10-05"); // lunes
    expect(mondayOf("2026-10-06")).toBe("2026-10-05"); // martes
    expect(mondayOf("2026-10-11")).toBe("2026-10-05"); // domingo
  });

  it("suma días cruzando el fin de año", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
  });

  it("lista los siete días de lunes a domingo", () => {
    expect(weekDates("2026-10-05")).toEqual([
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
      "2026-10-10",
      "2026-10-11",
    ]);
  });
});

describe("openSlotError", () => {
  const ahora = new Date("2026-10-06T15:00:00Z"); // 12:00 en Argentina

  it("acepta una hora futura de hoy", () => {
    expect(openSlotError("2026-10-06T13", ahora)).toBeNull();
  });

  it.each([
    ["una hora pasada", "2026-10-06T11"],
    ["la hora que ya empezó", "2026-10-06T12"],
    ["antes de las 08:00", "2026-10-07T07"],
    ["después de las 21:00", "2026-10-07T22"],
    ["demasiado lejos", "2027-06-01T10"],
    ["una clave inválida", "basura"],
  ])("rechaza %s", (_nombre, clave) => {
    expect(openSlotError(clave, ahora)).not.toBeNull();
  });
});
