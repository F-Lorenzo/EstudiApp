import { z } from "zod";

/** Largos del motivo de una apelación y de la respuesta de la administración (los mismos que pone la base, 0027). */
export const APPEAL_REASON_MIN = 10;
export const APPEAL_TEXT_MAX = 600;

export const appealSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(APPEAL_REASON_MIN, { error: `Contanos por qué la apelás (al menos ${APPEAL_REASON_MIN} caracteres).` })
    .max(APPEAL_TEXT_MAX, { error: `El motivo puede tener hasta ${APPEAL_TEXT_MAX} caracteres.` }),
});

/** Aceptar no pide respuesta; rechazar sí (se le muestra al docente). */
export const appealDecisionSchema = z
  .object({
    accept: z.boolean(),
    response: z
      .string()
      .trim()
      .max(APPEAL_TEXT_MAX, { error: `La respuesta puede tener hasta ${APPEAL_TEXT_MAX} caracteres.` })
      .optional()
      .transform((value) => value || null),
  })
  .refine((value) => value.accept || value.response !== null, {
    message: "Escribí una respuesta para el docente.",
    path: ["response"],
  });
