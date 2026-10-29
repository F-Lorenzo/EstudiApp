import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { longDate, relativeDate } from "@/lib/format";

/**
 * Niveles y apelación de reseñas (migración 0027). Las reglas viven en la base: el nivel sale de
 * `my_commission_level` (la misma cuenta que la comisión), se apela con `appeal_rating` (una reseña propia de menos
 * de 3 estrellas, una vez) y decide solo la administración con `decide_rating_appeal`. Acá solo se lee y se traduce.
 */

/** Las reseñas de menos de estas estrellas se pueden apelar. */
export const APPEALABLE_BELOW = 3;

const num = z.union([z.number(), z.string()]).transform(Number).pipe(z.number().finite());
const maybeNum = z.union([z.number(), z.string(), z.null()]).transform((v) => (v === null ? null : Number(v)));

const levelSchema = z.object({
  enabled: z.boolean(),
  level_name: z.string(),
  rate: num,
  reviews: num,
  average: maybeNum,
  next: z
    .object({ name: z.string(), min_reviews: num, min_rating: num, rate: num })
    .nullable(),
});

export type MyLevel = {
  /** Si la comisión por reputación está encendida (apagada, se paga la base aunque haya nivel). */
  enabled: boolean;
  name: string;
  /** La comisión que paga hoy en sus nuevas reservas. */
  rate: number;
  /** Reseñas que cuentan: de clases dadas y pagas, una por alumno. */
  reviews: number;
  average: number | null;
  next: { name: string; minReviews: number; minRating: number; rate: number } | null;
};

export async function getMyLevel(supabase: Pick<SupabaseClient, "rpc">): Promise<MyLevel | null> {
  const { data, error } = await supabase.rpc("my_commission_level");
  const parsed = levelSchema.safeParse(data);
  if (error || !parsed.success) return null;
  const l = parsed.data;
  return {
    enabled: l.enabled,
    name: l.level_name,
    rate: l.rate,
    reviews: l.reviews,
    average: l.average,
    next: l.next
      ? { name: l.next.name, minReviews: l.next.min_reviews, minRating: l.next.min_rating, rate: l.next.rate }
      : null,
  };
}

/** Qué le falta para el siguiente nivel: «8 reseñas más» y «un promedio de 4,7 o más», lo que corresponda. */
export function missingForNext(level: Pick<MyLevel, "reviews" | "average" | "next">): string[] {
  if (!level.next) return [];
  const missing: string[] = [];
  const more = level.next.minReviews - level.reviews;
  if (more > 0) missing.push(`${more} ${more === 1 ? "reseña" : "reseñas"} más`);
  if (level.average === null || level.average < level.next.minRating) {
    missing.push(`un promedio de ${level.next.minRating.toLocaleString("es-AR")} o más`);
  }
  return missing;
}

export type AppealStatus = "pendiente" | "aceptada" | "rechazada";
const status = z.enum(["pendiente", "aceptada", "rechazada"]);

const myReviewSchema = z.object({
  rating_id: z.string(),
  score: num,
  comment: z.string().nullable(),
  created_at: z.string(),
  class_starts_at: z.string(),
  author_name: z.string(),
  removed: z.boolean(),
  appeal_id: z.string().nullable(),
  appeal_status: status.nullable(),
  appeal_reason: z.string().nullable(),
  appeal_response: z.string().nullable(),
  appeal_created_at: z.string().nullable(),
  appeal_decided_at: z.string().nullable(),
});

export type MyReview = {
  ratingId: string;
  score: number;
  comment: string | null;
  author: string;
  createdAt: string;
  /** «hace 3 días». */
  ago: string;
  /** El día de la clase. */
  classDay: string;
  /** La administración la quitó (apelación aceptada): ya no cuenta ni se muestra. */
  removed: boolean;
  appeal: {
    status: AppealStatus;
    reason: string;
    response: string | null;
    decidedAgo: string | null;
  } | null;
  canAppeal: boolean;
};

export async function getMyReviews(
  supabase: Pick<SupabaseClient, "rpc">,
  { now = new Date() }: { now?: Date } = {},
): Promise<{ reviews: MyReview[]; error: boolean }> {
  const { data, error } = await supabase.rpc("my_reviews");
  if (error || !Array.isArray(data)) return { reviews: [], error: true };
  const reviews = data.flatMap((row): MyReview[] => {
    const p = myReviewSchema.safeParse(row);
    if (!p.success) return [];
    const r = p.data;
    return [
      {
        ratingId: r.rating_id,
        score: r.score,
        comment: r.comment,
        author: r.author_name,
        createdAt: r.created_at,
        ago: relativeDate(r.created_at, now),
        classDay: longDate(r.class_starts_at),
        removed: r.removed,
        appeal:
          r.appeal_id && r.appeal_status
            ? {
                status: r.appeal_status,
                reason: r.appeal_reason ?? "",
                response: r.appeal_response,
                decidedAgo: r.appeal_decided_at ? relativeDate(r.appeal_decided_at, now) : null,
              }
            : null,
        canAppeal: !r.removed && !r.appeal_id && r.score < APPEALABLE_BELOW,
      },
    ];
  });
  return { reviews, error: false };
}

const adminAppealSchema = z.object({
  appeal_id: z.string(),
  status,
  tutor_id: z.string(),
  tutor_name: z.string().nullable(),
  student_name: z.string().nullable(),
  score: num,
  comment: z.string().nullable(),
  rated_at: z.string(),
  class_starts_at: z.string(),
  reason: z.string(),
  response: z.string().nullable(),
  created_at: z.string(),
  decided_at: z.string().nullable(),
  decided_by_name: z.string().nullable(),
});

export type AdminAppeal = {
  id: string;
  status: AppealStatus;
  tutorId: string;
  tutorName: string;
  studentName: string;
  score: number;
  comment: string | null;
  classDay: string;
  reason: string;
  response: string | null;
  /** «hace 2 días» desde que se apeló. */
  ago: string;
  decidedBy: string | null;
  decidedAgo: string | null;
};

export async function getAdminAppeals(
  supabase: Pick<SupabaseClient, "rpc">,
  { now = new Date() }: { now?: Date } = {},
): Promise<{ appeals: AdminAppeal[]; error: boolean }> {
  const { data, error } = await supabase.rpc("admin_rating_appeals");
  if (error || !Array.isArray(data)) return { appeals: [], error: true };
  const appeals = data.flatMap((row): AdminAppeal[] => {
    const p = adminAppealSchema.safeParse(row);
    if (!p.success) return [];
    const a = p.data;
    return [
      {
        id: a.appeal_id,
        status: a.status,
        tutorId: a.tutor_id,
        tutorName: a.tutor_name?.trim() || "Docente",
        studentName: a.student_name?.trim() || "Estudiante",
        score: a.score,
        comment: a.comment,
        classDay: longDate(a.class_starts_at),
        reason: a.reason,
        response: a.response,
        ago: relativeDate(a.created_at, now),
        decidedBy: a.decided_by_name,
        decidedAgo: a.decided_at ? relativeDate(a.decided_at, now) : null,
      },
    ];
  });
  return { appeals, error: false };
}

/** Lo que se le dice al docente según el error de `appeal_rating`. */
export function appealErrorMessage(hint: string | undefined): string {
  switch (hint) {
    case "not_appealable":
      return "Solo se pueden apelar las reseñas de 1 o 2 estrellas.";
    case "already_appealed":
      return "Ya apelaste esta reseña.";
    case "reason_required":
      return "Contanos por qué la apelás (al menos 10 caracteres).";
    case "reason_too_long":
      return "El motivo puede tener hasta 600 caracteres.";
    case "not_found":
      return "No encontramos esa reseña.";
    default:
      return "No pudimos enviar la apelación. Intentá de nuevo en un momento.";
  }
}

/** Lo que se le dice a la administración según el error de `decide_rating_appeal`. */
export function decisionErrorMessage(hint: string | undefined): string {
  switch (hint) {
    case "already_decided":
      return "Esta apelación ya se decidió. Actualizá la página.";
    case "response_required":
      return "Escribí una respuesta para el docente.";
    case "response_too_long":
      return "La respuesta puede tener hasta 600 caracteres.";
    case "not_found":
      return "No encontramos esa apelación.";
    case "not_admin":
      return "No tenés permiso para decidir apelaciones.";
    default:
      return "No pudimos guardar la decisión. Intentá de nuevo en un momento.";
  }
}
