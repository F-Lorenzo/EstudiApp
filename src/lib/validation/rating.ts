import { z } from "zod";

/** Largo máximo del comentario (el mismo límite que pone la base, migración 0016). */
export const RATING_COMMENT_MAX = 600;

/** Lo que manda el formulario de calificación. El docente y el alumno NO se aceptan desde acá: salen de la reserva. */
export const ratingSchema = z.object({
  score: z.coerce
    .number({ error: "Elegí de 1 a 5 estrellas." })
    .int({ error: "Elegí de 1 a 5 estrellas." })
    .min(1, { error: "Elegí de 1 a 5 estrellas." })
    .max(5, { error: "Elegí de 1 a 5 estrellas." }),
  comment: z
    .string()
    .trim()
    .max(RATING_COMMENT_MAX, { error: `El comentario puede tener hasta ${RATING_COMMENT_MAX} caracteres.` })
    .optional()
    .transform((value) => value || null),
});

export type RatingInput = z.infer<typeof ratingSchema>;
