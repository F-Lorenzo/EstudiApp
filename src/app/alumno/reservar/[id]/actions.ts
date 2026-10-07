"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { bookingErrorMessage, isStaleStateError } from "@/lib/bookings/errors";
import { createClient } from "@/lib/supabase/server";

export type ReserveResult = { ok: false; error: string };

/**
 * Reserva un horario. La validación real (horario libre, con anticipación,
 * docente aprobado, sin solaparse con otra clase del alumno, tope de reservas
 * sin pagar) la hace la función `create_booking` de la base; acá solo se valida
 * el formato y se traduce el error.
 *
 * Si el alumno ya tenía ese horario reservado, la función devuelve su reserva
 * en lugar de fallar, así que volver atrás y reservar de nuevo lleva al mismo
 * pago. Si sale bien, redirige a la pantalla de la reserva, donde se paga.
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
    // Si el horario ya no está, se vuelve a leer la lista: así desaparece del
    // selector en lugar de quedar elegido y fallar otra vez.
    if (isStaleStateError(error)) revalidatePath("/alumno/reservar/[id]", "page");
    return { ok: false, error: bookingErrorMessage(error) };
  }

  revalidatePath("/alumno", "layout");
  redirect(`/alumno/reservas/${data}`);
}
