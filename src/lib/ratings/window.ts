/**
 * Hasta cuándo se puede calificar una clase: 30 días después de que termina. La regla real vive en la base
 * (política de `ratings`, migración 0016); esto solo decide si la interfaz ofrece el formulario.
 */
export const RATING_WINDOW_DAYS = 30;

const DAY = 86_400_000;

export function canRate(
  { status, endsAt, score, ratingRemoved = false }: { status: string; endsAt: string; score: number | null; ratingRemoved?: boolean },
  now: Date = new Date(),
) {
  if (status !== "completada" || score != null || ratingRemoved) return false;
  return now.getTime() - new Date(endsAt).getTime() < RATING_WINDOW_DAYS * DAY;
}
