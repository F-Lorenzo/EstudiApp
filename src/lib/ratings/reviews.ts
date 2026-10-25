import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { relativeDate } from "@/lib/format";

/** Opinión pública de un docente, lista para mostrar. */
export type PublicReview = {
  score: number;
  comment: string | null;
  /** Nombre y la inicial del apellido («Tomás R.»), o «Estudiante». */
  author: string;
  /** ISO, para `<time dateTime>`. */
  createdAt: string;
  /** «hace 3 días», «hace 2 meses». */
  ago: string;
};

const rowSchema = z.object({
  score: z.coerce.number(),
  comment: z.string().nullable(),
  created_at: z.string(),
  author_name: z.string(),
  review_count: z.coerce.number(),
});

/**
 * Opiniones de un docente aprobado, de la más reciente a la más antigua (`tutor_reviews`, migración 0016).
 * La tabla `ratings` no es pública: esta función devuelve solo lo que se muestra, sin el id del alumno.
 */
export async function getTutorReviews(
  supabase: Pick<SupabaseClient, "rpc">,
  tutorId: string,
  { limit = 50, now = new Date() }: { limit?: number; now?: Date } = {},
): Promise<{ reviews: PublicReview[]; total: number }> {
  const { data, error } = await supabase.rpc("tutor_reviews", { p_tutor_id: tutorId, p_limit: limit });
  if (error || !Array.isArray(data)) return { reviews: [], total: 0 };
  const rows = data.map((row) => rowSchema.safeParse(row)).flatMap((r) => (r.success ? [r.data] : []));
  return {
    total: rows[0]?.review_count ?? 0,
    reviews: rows.map((row) => ({
      score: row.score,
      comment: row.comment,
      author: row.author_name,
      createdAt: row.created_at,
      ago: relativeDate(row.created_at, now),
    })),
  };
}
