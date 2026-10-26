import { describe, expect, it } from "vitest";
import { PRIVATE_PATHS, siteIndexable } from "./indexing";

const PROD = { SITE_INDEXABLE: "true", NEXT_PUBLIC_SITE_URL: "https://estudiapp.app" };

describe("siteIndexable", () => {
  it("se indexa solo con el interruptor encendido y en la dirección del sitio", () => {
    expect(siteIndexable(PROD, "estudiapp.app")).toBe(true);
    expect(siteIndexable({ ...PROD, SITE_INDEXABLE: " TRUE " }, "ESTUDIAPP.APP")).toBe(true);
  });

  it("apagado por defecto", () => {
    expect(siteIndexable({ NEXT_PUBLIC_SITE_URL: "https://estudiapp.app" }, "estudiapp.app")).toBe(false);
    for (const value of ["", "false", "1", "yes", "sí"]) {
      expect(siteIndexable({ ...PROD, SITE_INDEXABLE: value }, "estudiapp.app")).toBe(false);
    }
  });

  it("una versión de prueba en otra dirección nunca se indexa", () => {
    expect(siteIndexable(PROD, "estudiapp.cuenta.workers.dev")).toBe(false);
    expect(siteIndexable(PROD, "www.estudiapp.app")).toBe(false);
    expect(siteIndexable(PROD, null)).toBe(false);
  });

  it("sin una dirección pública con https no se indexa", () => {
    expect(siteIndexable({ SITE_INDEXABLE: "true" }, "estudiapp.app")).toBe(false);
    expect(siteIndexable({ SITE_INDEXABLE: "true", NEXT_PUBLIC_SITE_URL: "http://localhost:3000" }, "localhost:3000")).toBe(false);
  });
});

describe("PRIVATE_PATHS", () => {
  // robots.txt compara por prefijo: «/docente» a secas bloquearía también el catálogo «/docentes».
  it("no bloquea el catálogo público", () => {
    const blocks = (path: string) =>
      PRIVATE_PATHS.some((rule) => (rule.endsWith("$") ? path === rule.slice(0, -1) : path.startsWith(rule)));
    expect(blocks("/docentes")).toBe(false);
    expect(blocks("/docentes/abc")).toBe(false);
    expect(blocks("/docente")).toBe(true);
    expect(blocks("/docente/perfil")).toBe(true);
    expect(blocks("/admin/sistema")).toBe(true);
    expect(blocks("/alumno")).toBe(true);
    expect(blocks("/api/mercadopago/webhook")).toBe(true);
  });
});
