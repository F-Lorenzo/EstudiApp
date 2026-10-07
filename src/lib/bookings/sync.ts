import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Pone al día las reservas antes de leerlas: las que no se pagaron a tiempo se
 * cancelan y liberan su horario, y las clases que terminaron pasan a
 * «completada» (`sync_bookings()` en la migración 0008). Funciona también sin
 * sesión, así que la usan hasta las páginas públicas.
 *
 * `cache` evita repetirla cuando varias consultas de una misma página usan el
 * mismo cliente. Si la función no existe (falta la migración 0008) se omite.
 */
export const syncBookings = cache(async (supabase: SupabaseClient) => {
  await supabase.rpc("sync_bookings");
});
