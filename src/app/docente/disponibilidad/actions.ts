"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getViewer } from "@/lib/auth/viewer";
import { openSlotError, parseSlotKey, slotEnd, slotStart } from "@/lib/availability/slots";
import { createClient } from "@/lib/supabase/server";

// Un guardado trae como mucho unas pocas semanas de cambios; el tope evita
// pedidos desmedidos.
const MAX_CHANGES = 300;

const saveSchema = z.object({
  /** Franjas que deben quedar abiertas (clave `YYYY-MM-DDTHH`, hora de Argentina). */
  open: z.array(z.string()).max(MAX_CHANGES),
  /** Franjas que deben quedar cerradas. */
  close: z.array(z.string()).max(MAX_CHANGES),
});

export type SaveAvailabilityResult =
  | { ok: true; opened: number; closed: number; protectedCount: number }
  | { ok: false; error: string };

/**
 * Guarda los cambios de la agenda del docente. Es idempotente: abrir una
 * franja que ya está abierta o cerrar una que ya está cerrada no hace nada.
 * Las franjas ya reservadas nunca se tocan.
 */
export async function saveAvailability(
  input: unknown,
): Promise<SaveAvailabilityResult> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "No pudimos leer los cambios. Actualizá la página e intentá de nuevo." };
  }

  const viewer = await getViewer();
  if (!viewer) {
    return { ok: false, error: "Tu sesión expiró. Volvé a iniciar sesión." };
  }
  if (viewer.role !== "docente") {
    return { ok: false, error: "Solo los docentes pueden administrar su disponibilidad." };
  }

  const openKeys = [...new Set(parsed.data.open)];
  // Una franja que se pide abrir y cerrar a la vez queda como estaba.
  const closeKeys = [...new Set(parsed.data.close)].filter(
    (key) => !openKeys.includes(key),
  );

  const now = new Date();
  for (const key of openKeys) {
    const problem = openSlotError(key, now);
    if (problem) return { ok: false, error: problem };
  }
  for (const key of closeKeys) {
    if (!parseSlotKey(key)) {
      return { ok: false, error: "Hay un horario con un formato inválido." };
    }
  }

  const supabase = await createClient();
  let opened = 0;
  let closed = 0;
  let protectedCount = 0;

  if (closeKeys.length) {
    const starts = closeKeys.map((key) => slotStart(key)!.toISOString());
    // Solo borra franjas libres (la RLS también lo exige): una reservada queda.
    const { data, error } = await supabase
      .from("availability_slots")
      .delete()
      .eq("tutor_id", viewer.id)
      .eq("is_booked", false)
      .in("starts_at", starts)
      .select("id");
    if (error) {
      return { ok: false, error: "No pudimos cerrar algunos horarios. Intentá de nuevo." };
    }
    closed = data?.length ?? 0;
    // Las franjas pedidas que no se borraron estaban reservadas (o ya cerradas).
    const { data: stillThere } = await supabase
      .from("availability_slots")
      .select("id")
      .eq("tutor_id", viewer.id)
      .eq("is_booked", true)
      .in("starts_at", starts);
    protectedCount = stillThere?.length ?? 0;
  }

  if (openKeys.length) {
    const starts = openKeys.map((key) => slotStart(key)!.toISOString());
    const { data: existing, error: lookupError } = await supabase
      .from("availability_slots")
      .select("starts_at")
      .eq("tutor_id", viewer.id)
      .in("starts_at", starts)
      .returns<{ starts_at: string }[]>();
    if (lookupError) {
      return { ok: false, error: "No pudimos abrir algunos horarios. Intentá de nuevo." };
    }
    const taken = new Set((existing ?? []).map((row) => new Date(row.starts_at).getTime()));
    const rows = openKeys
      .filter((key) => !taken.has(slotStart(key)!.getTime()))
      .map((key) => ({
        tutor_id: viewer.id,
        starts_at: slotStart(key)!.toISOString(),
        ends_at: slotEnd(key)!.toISOString(),
      }));
    if (rows.length) {
      const { error } = await supabase.from("availability_slots").insert(rows);
      if (error) {
        return { ok: false, error: "No pudimos abrir algunos horarios. Intentá de nuevo." };
      }
      opened = rows.length;
    }
  }

  revalidatePath("/docente/disponibilidad");
  revalidatePath("/docente");
  return { ok: true, opened, closed, protectedCount };
}
