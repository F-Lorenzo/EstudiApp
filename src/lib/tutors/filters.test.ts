import { describe, expect, it } from "vitest";
import {
  PRICE_CEILING,
  PRICE_FLOOR,
  catalogQueryString,
  parseCatalogFilters,
} from "./filters";

describe("parseCatalogFilters", () => {
  it("sin parámetros devuelve los valores por defecto", () => {
    expect(parseCatalogFilters({})).toEqual({
      q: "",
      materias: [],
      precioMax: null,
      disponibilidad: false,
      orden: "calificacion",
    });
  });

  it("una clave repetida en la URL usa la primera para el texto", () => {
    expect(parseCatalogFilters({ q: ["álgebra", "otra"] }).q).toBe("álgebra");
  });

  it("acepta una o varias materias", () => {
    expect(parseCatalogFilters({ materia: "Física" }).materias).toEqual(["Física"]);
    expect(parseCatalogFilters({ materia: ["Física", "Química"] }).materias).toEqual(["Física", "Química"]);
  });

  it("ignora un precio fuera del rango o que no es un número", () => {
    expect(parseCatalogFilters({ precioMax: String(PRICE_FLOOR - 1) }).precioMax).toBeNull();
    expect(parseCatalogFilters({ precioMax: String(PRICE_CEILING) }).precioMax).toBeNull();
    expect(parseCatalogFilters({ precioMax: "abc" }).precioMax).toBeNull();
    expect(parseCatalogFilters({ precioMax: "12000" }).precioMax).toBe(12000);
  });

  it("solo reconoce el orden por precio; cualquier otro valor es por calificación", () => {
    expect(parseCatalogFilters({ orden: "precio" }).orden).toBe("precio");
    expect(parseCatalogFilters({ orden: "x" }).orden).toBe("calificacion");
  });
});

describe("catalogQueryString", () => {
  it("sin filtros no agrega nada", () => {
    expect(catalogQueryString(parseCatalogFilters({}))).toBe("");
  });

  it("es el inverso de parseCatalogFilters", () => {
    const filtros = parseCatalogFilters({
      q: "física",
      materia: ["Física", "Química"],
      precioMax: "15000",
      disponibilidad: "on",
      orden: "precio",
    });
    const url = new URLSearchParams(catalogQueryString(filtros).slice(1));
    const params = {
      q: url.get("q") ?? undefined,
      materia: url.getAll("materia"),
      precioMax: url.get("precioMax") ?? undefined,
      disponibilidad: url.get("disponibilidad") ?? undefined,
      orden: url.get("orden") ?? undefined,
    };
    expect(parseCatalogFilters(params)).toEqual(filtros);
  });
});
