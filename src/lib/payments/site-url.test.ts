import { describe, expect, it } from "vitest";
import { siteUrl, siteUrlOrNull } from "./site-url";

describe("dirección pública de la app", () => {
  it("devuelve el origen sin barra final", () => {
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: "https://estudiapp.example/" })).toBe("https://estudiapp.example");
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: " https://estudiapp.example/ruta/de/mas " })).toBe("https://estudiapp.example");
  });

  it("acepta http solo en localhost", () => {
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: "http://localhost:3000" })).toBe("http://localhost:3000");
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3000" })).toBe("http://127.0.0.1:3000");
    expect(() => siteUrl({ NEXT_PUBLIC_SITE_URL: "http://estudiapp.example" })).toThrow(/https/);
  });

  it("rechaza lo ausente o inválido", () => {
    expect(() => siteUrl({})).toThrow(/Falta/);
    expect(() => siteUrl({ NEXT_PUBLIC_SITE_URL: "  " })).toThrow(/Falta/);
    expect(() => siteUrl({ NEXT_PUBLIC_SITE_URL: "no es una url" })).toThrow(/válida/);
    expect(() => siteUrl({ NEXT_PUBLIC_SITE_URL: "javascript:alert(1)" })).toThrow();
  });

  it("la variante tolerante devuelve null en vez de lanzar", () => {
    expect(siteUrlOrNull({})).toBeNull();
    expect(siteUrlOrNull({ NEXT_PUBLIC_SITE_URL: "https://estudiapp.example" })).toBe("https://estudiapp.example");
  });
});
