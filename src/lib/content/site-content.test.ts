import { describe, expect, it } from "vitest";
import { siteContentSchema } from "@/lib/validation/site-content";
import { fakeSupabase } from "@/test/fake-supabase";
import { announcementFrom, DEFAULT_HERO, EMPTY_SITE_CONTENT, getSiteContentRow, heroFrom, isSafeLink } from "./site-content";

const NOW = new Date("2026-10-26T15:00:00Z");

describe("heroFrom", () => {
  it("sin contenido, o con todo vacío, usa el texto original", () => {
    for (const row of [null, EMPTY_SITE_CONTENT]) {
      expect(heroFrom(row)).toEqual({
        titleLines: ["Hay una forma", "de entenderlo."],
        highlight: DEFAULT_HERO.highlight,
        description: DEFAULT_HERO.description,
        defaultDescription: true,
      });
    }
  });

  it("usa el texto de la administración, en renglones", () => {
    const hero = heroFrom({ ...EMPTY_SITE_CONTENT, heroTitle: "Aprender\n\ncambia todo.", heroHighlight: "Con vos.", heroDescription: "Clases uno a uno." });
    expect(hero).toEqual({ titleLines: ["Aprender", "cambia todo."], highlight: "Con vos.", description: "Clases uno a uno.", defaultDescription: false });
  });
});

describe("announcementFrom", () => {
  const on = { ...EMPTY_SITE_CONTENT, announcementEnabled: true, announcementText: "Inscripciones abiertas" };

  it("solo se muestra encendida, con texto y antes de su fecha de fin", () => {
    expect(announcementFrom(on, NOW)).toEqual({ text: "Inscripciones abiertas", linkLabel: null, linkUrl: null });
    expect(announcementFrom({ ...on, announcementEnabled: false }, NOW)).toBeNull();
    expect(announcementFrom({ ...on, announcementText: "  " }, NOW)).toBeNull();
    expect(announcementFrom({ ...on, announcementEndsAt: "2026-10-26T14:59:59Z" }, NOW)).toBeNull();
    expect(announcementFrom({ ...on, announcementEndsAt: "2026-10-27T02:59:59Z" }, NOW)).not.toBeNull();
    expect(announcementFrom(null, NOW)).toBeNull();
  });

  it("un enlace inseguro no se muestra aunque venga de la base", () => {
    expect(announcementFrom({ ...on, announcementLinkLabel: "Ver", announcementLinkUrl: "javascript:alert(1)" }, NOW)?.linkUrl).toBeNull();
    expect(announcementFrom({ ...on, announcementLinkLabel: "Ver", announcementLinkUrl: "/docentes" }, NOW)).toMatchObject({ linkLabel: "Ver", linkUrl: "/docentes" });
  });
});

describe("isSafeLink", () => {
  it("acepta rutas del sitio y https; nada más", () => {
    for (const url of ["/", "/docentes", "/docentes?q=Física", "https://estudiapp.app/x"]) expect(isSafeLink(url)).toBe(true);
    for (const url of ["//malo.example", "/\\malo", "http://x.example", "javascript:alert(1)", "docentes", "https://"]) expect(isSafeLink(url)).toBe(false);
  });
});

describe("siteContentSchema", () => {
  const base = { heroTitle: "", heroHighlight: "", heroDescription: "", announcementText: "", announcementLinkLabel: "", announcementLinkUrl: "", announcementEndsAt: "" };

  it("vacío vuelve todo al original y apaga el anuncio", () => {
    expect(siteContentSchema.parse(base)).toEqual({
      heroTitle: null,
      heroHighlight: null,
      heroDescription: null,
      announcementEnabled: false,
      announcementText: null,
      announcementLinkLabel: null,
      announcementLinkUrl: null,
      announcementEndsAt: null,
    });
  });

  it("limpia renglones vacíos y espacios, y pasa la fecha al fin del día en Argentina", () => {
    const parsed = siteContentSchema.parse({
      ...base,
      heroTitle: " Aprender \r\n\r\n cambia todo. ",
      announcementEnabled: "on",
      announcementText: "Inscripciones   abiertas",
      announcementLinkLabel: "Ver docentes",
      announcementLinkUrl: "/docentes",
      announcementEndsAt: "2026-11-30",
    });
    expect(parsed).toMatchObject({
      heroTitle: "Aprender\ncambia todo.",
      announcementEnabled: true,
      announcementText: "Inscripciones abiertas",
      announcementEndsAt: "2026-11-30T23:59:59-03:00",
    });
  });

  it("rechaza más de 3 renglones, textos largos, enlaces inseguros o incompletos y anuncio encendido sin texto", () => {
    for (const input of [
      { ...base, heroTitle: "a\nb\nc\nd" },
      { ...base, heroHighlight: "x".repeat(31) },
      { ...base, announcementText: "Hola", announcementLinkLabel: "Ver", announcementLinkUrl: "javascript:alert(1)" },
      { ...base, announcementText: "Hola", announcementLinkUrl: "/docentes" },
      { ...base, announcementText: "Hola", announcementLinkLabel: "Ver" },
      { ...base, announcementEnabled: "on" },
      { ...base, announcementEndsAt: "mañana" },
    ]) {
      expect(siteContentSchema.safeParse(input).success).toBe(false);
    }
  });
});

describe("getSiteContentRow", () => {
  it("si la base falla, devuelve null (la Home usa el original)", async () => {
    const supabase = fakeSupabase({ tables: { site_content: { error: { message: "x" } } } });
    expect(await getSiteContentRow(supabase.client as never)).toBeNull();
  });
});
