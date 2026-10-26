import { z } from "zod";

/** Lo que la base acepta como motivo (migración 0019 lo recorta a 500 caracteres). */
export const MODERATION_REASON_MAX = 500;

export const rejectTutorSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, "Ingresá el motivo del rechazo")
    .max(MODERATION_REASON_MAX, `Usá ${MODERATION_REASON_MAX} caracteres como máximo`),
});

export const deactivateTutorSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, "Ingresá el motivo de la baja")
    .max(MODERATION_REASON_MAX, `Usá ${MODERATION_REASON_MAX} caracteres como máximo`),
});

export const reopenTutorSchema = z.object({
  note: z
    .string()
    .trim()
    .max(MODERATION_REASON_MAX, `Usá ${MODERATION_REASON_MAX} caracteres como máximo`)
    .transform((value) => value || null),
});
