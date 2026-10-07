"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { bookingErrorMessage } from "@/lib/bookings/errors";
import { createClient } from "@/lib/supabase/server";

export type ReserveResult = { ok: false; error: string };

/**
 * Reserva un horario. La validación real (horario libre, con anticipación,
 * docente aprobado, sin solaparse con otra clase del alumno) la hace la función
 * `create_booking` de la base; acá solo se valida el formato y se traduce el error.
 * Si sale bien, lleva a la pantalla de la reserva, donde se paga.
 */
export async function reserveSlot(slotId: string): Promise<ReserveResult> {
  const parsed = z.uuid().safeParse(slotId);
  if (!parsed.success) {
    return { ok: false, error: bookingErrorMessage({ hint: "slot_not_found" }) };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_booking", {
    p_slot_id: parsed.data,
  });

  if (error || typeof data !== "string") {
    return { ok: false, error: bookingErrorMessage(error) };
  }

  revalidatePath("/alumno");
  redirect(`/alumno/reservas/${data}`);
}
