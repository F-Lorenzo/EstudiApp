"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";

export type UnlinkPayoutAccountResult = { ok: true } | { ok: false; error: string };

// Traducción de los códigos (`hint`) de `unlink_my_mp_account` a mensajes para el docente.
const MESSAGES = {
  has_active_bookings:
    "Todavía tenés clases reservadas o por pagar. Vas a poder desvincular tu cuenta cuando se den o se cancelen.",
  has_pending_refunds:
    "Hay reembolsos en curso con esta cuenta. Vas a poder desvincularla cuando se completen.",
  not_linked: "Tu cuenta de Mercado Pago ya estaba desvinculada.",
  not_authenticated: "Tu sesión expiró. Volvé a iniciar sesión.",
} as const;

const GENERIC_ERROR = "No pudimos desvincular tu cuenta. Intentá de nuevo en un momento.";

/**
 * Desvincula la cuenta de cobro del docente que tiene la sesión abierta. Se hace con SU sesión (no con la
 * service role): la función de la base (`unlink_my_mp_account`) usa `auth.uid()` y decide si se puede (no si
 * hay clases por dar o reembolsos sin cerrar con esa cuenta). Repetirla es inocuo: la segunda vez avisa
 * que ya estaba desvinculada.
 */
export async function unlinkPayoutAccount(): Promise<UnlinkPayoutAccountResult> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: MESSAGES.not_authenticated };
  if (viewer.role !== "docente") {
    return { ok: false, error: "Solo los docentes tienen una cuenta de cobro." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("unlink_my_mp_account");

  if (error) {
    // Si ya estaba desvinculada, el panel tiene que reflejarlo igual.
    if (error.hint === "not_linked") revalidatePath("/docente");
    const known = Object.hasOwn(MESSAGES, error.hint) ? MESSAGES[error.hint as keyof typeof MESSAGES] : GENERIC_ERROR;
    return { ok: false, error: known };
  }

  revalidatePath("/docente");
  return { ok: true };
}
