import { describe, expect, it } from "vitest";
import { commissionSettingsSchema, commissionTierSchema } from "./commission";

describe("commissionSettingsSchema", () => {
  it("pasa porcentajes a tasa, con coma o punto", () => {
    expect(commissionSettingsSchema.parse({ baseName: " Profesor ", enabled: "on", base: "12", floor: "6,5" })).toEqual({
      baseName: "Profesor",
      enabled: true,
      base: 0.12,
      floor: 0.065,
    });
    expect(commissionSettingsSchema.parse({ baseName: "Profesor", base: "12.25", floor: "6" })).toEqual({
      baseName: "Profesor",
      enabled: false,
      base: 0.1225,
      floor: 0.06,
    });
  });

  it("rechaza vacíos, negativos, 100 % o más y un piso mayor que la base", () => {
    for (const input of [
      { base: "", floor: "6" },
      { base: "12", floor: "-1" },
      { base: "100", floor: "6" },
      { base: "abc", floor: "6" },
      { base: "8", floor: "10" },
    ].map((input) => ({ baseName: "Profesor", ...input }))) {
      expect(commissionSettingsSchema.safeParse(input).success).toBe(false);
    }
  });

  it("el nivel base necesita un nombre de hasta 40 caracteres", () => {
    for (const baseName of ["", "   ", "x".repeat(41)]) {
      expect(commissionSettingsSchema.safeParse({ baseName, base: "12", floor: "6" }).success).toBe(false);
    }
  });
});

describe("commissionTierSchema", () => {
  it("acepta un escalón válido", () => {
    expect(commissionTierSchema.parse({ name: " Gran profesor ", minReviews: "10", minRating: "4,5", rate: "10", active: "on" })).toEqual({
      name: "Gran profesor",
      minReviews: 10,
      minRating: 4.5,
      rate: 0.1,
      active: true,
    });
  });

  it("rechaza reseñas no enteras o cero, y calificaciones fuera de 1 a 5", () => {
    for (const input of [
      { minReviews: "0", minRating: "4", rate: "10" },
      { minReviews: "2.5", minRating: "4", rate: "10" },
      { minReviews: "10", minRating: "6", rate: "10" },
      { minReviews: "10", minRating: "", rate: "10" },
      { minReviews: "10", minRating: "4", rate: "" },
      { name: "", minReviews: "10", minRating: "4", rate: "10" },
      { name: "x".repeat(41), minReviews: "10", minRating: "4", rate: "10" },
    ].map((input) => ({ name: "Maestro", ...input }))) {
      expect(commissionTierSchema.safeParse(input).success).toBe(false);
    }
  });
});
