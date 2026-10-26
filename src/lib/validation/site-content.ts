import { z } from "zod";
import { ANNOUNCEMENT_LIMITS, HERO_LIMITS, isSafeLink } from "@/lib/content/site-content";

/** Un texto opcional: vacío pasa a `null` (en el hero, `null` es «usar el texto original»). */
const optionalText = (max: number, label: string) =>
  z
    .string()
    .transform((value) => value.replace(/\r\n?/g, "\n").trim())
    .pipe(z.string().max(max, `${label}: hasta ${max} caracteres.`))
    .transform((value) => value || null);

/** «2026-11-30» → fin de ese día en hora de Argentina (UTC−3). Vacío: sin fecha de fin. */
const endDate = z
  .string()
  .trim()
  .refine((value) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value), "Elegí una fecha válida.")
  .transform((value) => (value ? `${value}T23:59:59-03:00` : null))
  .refine((value) => !value || !Number.isNaN(Date.parse(value)), "Elegí una fecha válida.");

export const siteContentSchema = z
  .object({
    heroTitle: optionalText(HERO_LIMITS.title, "El título")
      .refine(
        (value) => !value || value.split("\n").filter((line) => line.trim()).length <= HERO_LIMITS.titleLines,
        `El título tiene hasta ${HERO_LIMITS.titleLines} renglones.`,
      )
      .transform((value) =>
        value
          ? value
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean)
              .join("\n")
          : null,
      ),
    heroHighlight: optionalText(HERO_LIMITS.highlight, "La frase subrayada"),
    heroDescription: optionalText(HERO_LIMITS.description, "El texto de apoyo").transform((value) =>
      value ? value.replace(/\s+/g, " ") : null,
    ),
    announcementEnabled: z.literal("on").optional().transform((value) => value === "on"),
    announcementText: optionalText(ANNOUNCEMENT_LIMITS.text, "El anuncio").transform((value) =>
      value ? value.replace(/\s+/g, " ") : null,
    ),
    announcementLinkLabel: optionalText(ANNOUNCEMENT_LIMITS.linkLabel, "El texto del enlace"),
    announcementLinkUrl: optionalText(ANNOUNCEMENT_LIMITS.linkUrl, "La dirección del enlace").refine(
      (value) => !value || isSafeLink(value),
      "Usá una ruta del sitio (por ejemplo /docentes) o una dirección que empiece con https://.",
    ),
    announcementEndsAt: endDate,
  })
  .refine((value) => !value.announcementEnabled || value.announcementText, {
    message: "Escribí el anuncio para poder mostrarlo.",
    path: ["announcementText"],
  })
  .refine((value) => !value.announcementLinkUrl || value.announcementLinkLabel, {
    message: "Escribí el texto del enlace.",
    path: ["announcementLinkLabel"],
  })
  .refine((value) => !value.announcementLinkLabel || value.announcementLinkUrl, {
    message: "Escribí la dirección del enlace.",
    path: ["announcementLinkUrl"],
  });
