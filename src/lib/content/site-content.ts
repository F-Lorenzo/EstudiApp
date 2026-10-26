import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

/**
 * Contenido editable de la Home (`site_content`, migración 0022): el texto del hero y la franja de anuncio. La
 * pizarra, la mascota y el diseño del hero no se editan (son una decisión central de la marca). Un campo del
 * hero vacío en la base usa el texto original, que vive acá.
 */

export const DEFAULT_HERO = {
  title: "Hay una forma\nde entenderlo.",
  highlight: "La tuya.",
  description: "Aprendé con profesores que tienen mucho para enseñarte. A tu ritmo, con experiencia real.",
} as const;

export const HERO_LIMITS = { title: 90, titleLines: 3, highlight: 30, description: 160 } as const;
export const ANNOUNCEMENT_LIMITS = { text: 140, linkLabel: 40, linkUrl: 300 } as const;

export type HeroContent = {
  /** Renglones del título (sin la frase subrayada). */
  titleLines: string[];
  highlight: string;
  description: string;
  /** El texto de apoyo es el original (la Home le pone su salto de línea de escritorio). */
  defaultDescription: boolean;
};

export type Announcement = { text: string; linkLabel: string | null; linkUrl: string | null };

/** Lo que guarda la administración, tal cual (para el editor). */
export type SiteContentRow = {
  heroTitle: string | null;
  heroHighlight: string | null;
  heroDescription: string | null;
  announcementEnabled: boolean;
  announcementText: string | null;
  announcementLinkLabel: string | null;
  announcementLinkUrl: string | null;
  announcementEndsAt: string | null;
};

const rowSchema = z.object({
  hero_title: z.string().nullable(),
  hero_highlight: z.string().nullable(),
  hero_description: z.string().nullable(),
  announcement_enabled: z.boolean(),
  announcement_text: z.string().nullable(),
  announcement_link_label: z.string().nullable(),
  announcement_link_url: z.string().nullable(),
  announcement_ends_at: z.string().nullable(),
});

const COLUMNS =
  "hero_title, hero_highlight, hero_description, announcement_enabled, announcement_text, announcement_link_label, announcement_link_url, announcement_ends_at";

export const EMPTY_SITE_CONTENT: SiteContentRow = {
  heroTitle: null,
  heroHighlight: null,
  heroDescription: null,
  announcementEnabled: false,
  announcementText: null,
  announcementLinkLabel: null,
  announcementLinkUrl: null,
  announcementEndsAt: null,
};

/** La fila de la base. Si falla, `null` (la Home muestra el texto original y sin anuncio). */
export async function getSiteContentRow(supabase: Pick<SupabaseClient, "from">): Promise<SiteContentRow | null> {
  const { data, error } = await supabase.from("site_content").select(COLUMNS).maybeSingle();
  const parsed = rowSchema.safeParse(data);
  if (error || !parsed.success) return null;
  const d = parsed.data;
  return {
    heroTitle: d.hero_title,
    heroHighlight: d.hero_highlight,
    heroDescription: d.hero_description,
    announcementEnabled: d.announcement_enabled,
    announcementText: d.announcement_text,
    announcementLinkLabel: d.announcement_link_label,
    announcementLinkUrl: d.announcement_link_url,
    announcementEndsAt: d.announcement_ends_at,
  };
}

/** Un enlace que se puede mostrar: una ruta del sitio o una dirección https (la base ya lo exige). */
export function isSafeLink(url: string) {
  return url === "/" || /^\/[^/\\]/.test(url) || /^https:\/\/[^\s/]+/.test(url);
}

export function heroFrom(row: SiteContentRow | null): HeroContent {
  const title = row?.heroTitle?.trim() || DEFAULT_HERO.title;
  return {
    titleLines: title.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, HERO_LIMITS.titleLines),
    highlight: row?.heroHighlight?.trim() || DEFAULT_HERO.highlight,
    description: row?.heroDescription?.trim() || DEFAULT_HERO.description,
    defaultDescription: !row?.heroDescription?.trim(),
  };
}

/** La franja, si está encendida, tiene texto y no venció. */
export function announcementFrom(row: SiteContentRow | null, now: Date = new Date()): Announcement | null {
  if (!row?.announcementEnabled || !row.announcementText?.trim()) return null;
  if (row.announcementEndsAt && new Date(row.announcementEndsAt).getTime() <= now.getTime()) return null;
  const linkOk = Boolean(row.announcementLinkLabel?.trim() && row.announcementLinkUrl && isSafeLink(row.announcementLinkUrl));
  return {
    text: row.announcementText.trim(),
    linkLabel: linkOk ? row.announcementLinkLabel!.trim() : null,
    linkUrl: linkOk ? row.announcementLinkUrl : null,
  };
}
