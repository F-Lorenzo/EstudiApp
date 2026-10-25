"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/auth/viewer";
import { ratingErrorMessage, submitRating } from "@/lib/ratings/submit";
import { createClient } from "@/lib/supabase/server";
import { echoValues, type ActionState } from "@/lib/validation/form-state";
import { ratingSchema } from "@/lib/validation/rating";

/** Calificación del alumno para una clase completada (formulario de la sala al terminar y del historial). */
export async function rateClass(
  bookingId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = echoValues(formData, ["score", "comment"]);
  const parsed = ratingSchema.safeParse({
    score: formData.get("score") ?? undefined,
    comment: formData.get("comment") ?? undefined,
  });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, values };

  const viewer = await getViewer();
  if (!viewer) return { error: "Tu sesión expiró. Volvé a iniciar sesión.", values };
  if (viewer.role !== "alumno") return { error: "Solo el alumno de la clase puede calificarla.", values };

  const supabase = await createClient();
  const result = await submitRating(supabase, { bookingId, studentId: viewer.id, rating: parsed.data });
  if (!result.ok) {
    if (result.reason === "already_rated") revalidatePath("/alumno/historial");
    return { error: ratingErrorMessage(result.reason), values: result.reason === "error" ? values : undefined };
  }

  revalidatePath("/alumno/historial");
  revalidatePath(`/alumno/sala/${bookingId}`);
  revalidatePath(`/docentes/${result.tutorId}`);
  revalidatePath("/docente");
  return { success: true };
}
