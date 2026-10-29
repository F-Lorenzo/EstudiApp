import { z } from "zod";

/** Un porcentaje escrito en el formulario («12» o «12,5») como tasa (0,125), con 4 decimales como la base. */
const percent = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `Ingresá ${label}.`)
    .transform((value) => value.replace(",", "."))
    .pipe(
      z.coerce
        .number<string>({ error: `Ingresá ${label} en porcentaje.` })
        .min(0, `${label[0].toUpperCase()}${label.slice(1)} no puede ser negativa.`)
        .max(99, `${label[0].toUpperCase()}${label.slice(1)} tiene que ser menor que 100 %.`),
    )
    .transform((value) => Math.round(value * 100) / 10000);

/** El nombre de un nivel («Gran profesor»), de 1 a 40 caracteres como en la base (migración 0027). */
export const LEVEL_NAME_MAX = 40;
const levelName = z
  .string()
  .trim()
  .min(1, "Poné un nombre para el nivel.")
  .max(LEVEL_NAME_MAX, `El nombre puede tener hasta ${LEVEL_NAME_MAX} caracteres.`);

export const commissionSettingsSchema = z
  .object({
    baseName: levelName,
    enabled: z.literal("on").optional().transform((value) => value === "on"),
    base: percent("la comisión base"),
    floor: percent("el piso"),
  })
  .refine((value) => value.floor <= value.base, {
    message: "El piso no puede ser mayor que la comisión base.",
    path: ["floor"],
  });

export const commissionTierSchema = z.object({
  name: levelName,
  minReviews: z.coerce
    .number({ error: "Ingresá cuántas reseñas hacen falta." })
    .int("Usá un número entero de reseñas.")
    .min(1, "Hace falta al menos 1 reseña.")
    .max(100000, "Es demasiado."),
  minRating: z
    .string()
    .trim()
    .min(1, "Ingresá la calificación mínima.")
    .transform((value) => value.replace(",", "."))
    .pipe(
      z.coerce
        .number<string>({ error: "Ingresá la calificación mínima." })
        .min(1, "La calificación mínima va de 1 a 5.")
        .max(5, "La calificación mínima va de 1 a 5."),
    )
    .transform((value) => Math.round(value * 100) / 100),
  rate: percent("la comisión"),
  active: z.literal("on").optional().transform((value) => value === "on"),
});
