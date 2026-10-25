import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { RatingInput } from "@/lib/validation/rating";
import { canRate } from "./window";

export type SubmitRatingResult =
  | { ok: true; tutorId: string }
  | { ok: false; reason: "not_found" | "not_completed" | "expired" | "already_rated" | "error" };

const bookingSchema = z.object({
  id: z.string(),
  student_id: z.string(),
  tutor_id: z.string(),
  status: z.string(),
  ends_at: z.string(),
});

/**
 * Guarda la calificación del alumno para una de sus clases. Se escribe con la sesión del alumno: la RLS
 * (migración 0016) es la que de verdad decide (clase propia, completada, de ese docente, dentro de los 30 días,
 * una sola vez). Lo de acá es para devolver un motivo claro antes de intentar.
 */
export async function submitRating(
  supabase: Pick<SupabaseClient, "from">,
  { bookingId, studentId, rating, now = new Date() }: { bookingId: string; studentId: string; rating: RatingInput; now?: Date },
): Promise<SubmitRatingResult> {
  if (!z.uuid().safeParse(bookingId).success) return { ok: false, reason: "not_found" };

  const { data, error } = await supabase
    .from("bookings")
    .select("id, student_id, tutor_id, status, ends_at, ratings(score)")
    .eq("id", bookingId)
    .maybeSingle();
  if (error) return { ok: false, reason: "error" };
  const parsed = bookingSchema.safeParse(data);
  if (!parsed.success || parsed.data.student_id !== studentId) return { ok: false, reason: "not_found" };
  const booking = parsed.data;

  const embed = (data as { ratings?: { score: number } | { score: number }[] | null }).ratings;
  const existing = Array.isArray(embed) ? embed[0] : embed;
  if (existing) return { ok: false, reason: "already_rated" };
  if (booking.status !== "completada") return { ok: false, reason: "not_completed" };
  if (!canRate({ status: booking.status, endsAt: booking.ends_at, score: null }, now)) return { ok: false, reason: "expired" };

  const { error: insertError } = await supabase.from("ratings").insert({
    booking_id: booking.id,
    student_id: studentId,
    tutor_id: booking.tutor_id,
    score: rating.score,
    comment: rating.comment,
  });
  if (insertError) {
    // 23505: ya había una calificación (otra pestaña, doble clic).
    if (insertError.code === "23505") return { ok: false, reason: "already_rated" };
    console.error(JSON.stringify({ source: "ratings", message: "no se pudo guardar la calificación", bookingId, code: insertError.code }));
    return { ok: false, reason: "error" };
  }
  return { ok: true, tutorId: booking.tutor_id };
}

export function ratingErrorMessage(reason: Exclude<SubmitRatingResult, { ok: true }>["reason"]) {
  switch (reason) {
    case "already_rated":
      return "Ya calificaste esta clase.";
    case "not_completed":
      return "Vas a poder calificar la clase cuando termine.";
    case "expired":
      return "Pasaron más de 30 días desde la clase: ya no se puede calificar.";
    case "not_found":
      return "No encontramos esa clase.";
    default:
      return "No pudimos guardar tu calificación. Probá de nuevo en unos segundos.";
  }
}
