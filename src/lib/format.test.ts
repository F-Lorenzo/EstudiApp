import { describe, expect, it } from "vitest";
import { dateKeyAR, dayParts, initials, longDate, money, timeAR, timeRange } from "./format";

// Argentina no cambia de horario: UTC-3 todo el año. Las pruebas no dependen de la zona de la máquina.
describe("fechas en hora de Argentina", () => {
  it("muestra la hora en formato de 24 h", () => {
    expect(timeAR("2026-10-08T18:00:00.000Z")).toBe("15:00");
    expect(timeAR("2026-10-08T03:30:00.000Z")).toBe("00:30");
  });

  it("arma el rango horario de una clase", () => {
    expect(timeRange("2026-10-08T18:00:00.000Z", "2026-10-08T19:00:00.000Z")).toBe("15:00 – 16:00 h");
  });

  it("el día es el de Argentina, no el de UTC", () => {
    expect(dateKeyAR("2026-10-09T02:30:00.000Z")).toBe("2026-10-08");
  });

  it("separa las partes del día", () => {
    const partes = dayParts("2026-10-08T18:00:00.000Z");
    expect(partes.day).toBe("8");
    expect(partes.weekday).toBe("jueves");
    expect(partes.monthLong).toBe("octubre");
  });

  it("escribe la fecha larga", () => {
    // Según la versión de ICU, el día de la semana lleva o no una coma.
    expect(longDate("2026-10-08T18:00:00.000Z")).toMatch(/^jueves,? 8 de octubre$/);
  });
});

describe("money", () => {
  it("formatea pesos argentinos sin decimales", () => {
    // El espacio entre el símbolo y el número puede ser un espacio duro.
    expect(money(12500).replace(/\s/g, " ")).toBe("$ 12.500");
  });
});

describe("initials", () => {
  it("toma las dos primeras iniciales", () => {
    expect(initials("Elena Martínez")).toBe("EM");
    expect(initials("  ana  maría   gómez ")).toBe("AM");
  });

  it("tiene un valor por defecto para un nombre vacío", () => {
    expect(initials("")).toBe("E");
  });
});
