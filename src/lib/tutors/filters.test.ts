import { describe, expect, it } from "vitest";
import {
  MAX_PAGE,
  PRICE_CEILING,
  PRICE_FLOOR,
  SEARCH_MAX_LENGTH,
  catalogQueryString,
  pageItems,
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
      pagina: 1,
    });
  });

  it("la página es un entero desde 2 hasta el tope; cualquier otra cosa es la 1", () => {
    expect(parseCatalogFilters({ pagina: "3" }).pagina).toBe(3);
    for (const pagina of ["0", "1", "-2", "2.5", "abc", "", String(MAX_PAGE + 1), "1e20"]) {
      expect(parseCatalogFilters({ pagina }).pagina).toBe(1);
    }
    expect(parseCatalogFilters({ pagina: String(MAX_PAGE) }).pagina).toBe(MAX_PAGE);
  });

  it("recorta el texto al largo que usa la base", () => {
    expect(parseCatalogFilters({ q: "a".repeat(500) }).q).toHaveLength(SEARCH_MAX_LENGTH);
    expect(parseCatalogFilters({ q: `${"a".repeat(SEARCH_MAX_LENGTH - 1)}  b` }).q).toBe("a".repeat(SEARCH_MAX_LENGTH - 1));
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
      pagina: "4",
    });
    const url = new URLSearchParams(catalogQueryString(filtros).slice(1));
    const params = {
      q: url.get("q") ?? undefined,
      materia: url.getAll("materia"),
      precioMax: url.get("precioMax") ?? undefined,
      disponibilidad: url.get("disponibilidad") ?? undefined,
      orden: url.get("orden") ?? undefined,
      pagina: url.get("pagina") ?? undefined,
    };
    expect(parseCatalogFilters(params)).toEqual(filtros);
  });
});

describe("pageItems", () => {
  it("con pocas páginas las muestra todas", () => {
    expect(pageItems(1, 1)).toEqual([1]);
    expect(pageItems(2, 3)).toEqual([1, 2, 3]);
    expect(pageItems(1, 5)).toEqual([1, 2, "…", 5]);
  });

  it("muestra la primera, la última y las vecinas de la actual", () => {
    expect(pageItems(5, 20)).toEqual([1, "…", 4, 5, 6, "…", 20]);
    expect(pageItems(20, 20)).toEqual([1, "…", 19, 20]);
  });

  it("no pone «…» en lugar de una sola página", () => {
    expect(pageItems(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(pageItems(3, 5)).toEqual([1, 2, 3, 4, 5]);
  });
});
