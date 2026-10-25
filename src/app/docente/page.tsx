import { redirect } from "next/navigation";
import { TeacherDashboard } from "@/components/teacher-dashboard";
import { getViewer } from "@/lib/auth/viewer";
import {
  getNextOpenSlot,
  getTutorClasses,
} from "@/lib/bookings/tutor-queries";
import { parseAccountNotice } from "@/lib/payments/account-notice";
import { createClient } from "@/lib/supabase/server";
import { syncViewerAttendance } from "@/lib/video/attendance-runtime";
import { buildPayoutAccountView } from "./cuenta-de-cobro/state";

export const metadata = { title: "Espacio docente" };

export default async function DocenteInicioPage({
  searchParams,
}: {
  // `cuenta`: resultado de la vinculación con Mercado Pago (lo deja la ruta de retorno del OAuth).
  searchParams: Promise<{ cuenta?: string | string[] }>;
}) {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");

  const { cuenta } = await searchParams;
  // Antes de leer: las clases que terminaron se completan (o se reembolsan) según la asistencia a la sala.
  await syncViewerAttendance(viewer);
  const supabase = await createClient();
  const [
    { data: tutor },
    upcoming,
    completed,
    nextOpenSlot,
    privateData,
    canReceive,
  ] =
    await Promise.all([
      supabase
        .from("tutor_profiles")
        .select("verification_status, verification_reason, rating_promedio")
        .eq("id", viewer.id)
        .single<{
          verification_status: string;
          verification_reason: string | null;
          rating_promedio: number;
        }>(),
      getTutorClasses(supabase, viewer.id, "confirmada"),
      getTutorClasses(supabase, viewer.id, "completada"),
      getNextOpenSlot(supabase, viewer.id),
      // Cuenta de cobro: la cuenta vinculada (solo la lee el dueño, por la RLS) y si sus credenciales
      // siguen vigentes. Los tokens nunca salen de la base.
      supabase
        .from("tutor_private")
        .select("mercadopago_account_id")
        .eq("id", viewer.id)
        .maybeSingle<{ mercadopago_account_id: string | null }>(),
      supabase.rpc("tutor_can_receive_payments", { p_tutor: viewer.id }),
    ]);

  return (
    <TeacherDashboard
      tutorId={viewer.id}
      status={tutor?.verification_status ?? "pendiente"}
      reason={tutor?.verification_reason ?? null}
      rating={Number(tutor?.rating_promedio) || 0}
      upcoming={upcoming.classes}
      completed={completed.classes}
      nextOpenSlot={nextOpenSlot}
      loadFailed={Boolean(upcoming.error || completed.error)}
      payoutAccount={buildPayoutAccountView({
        accountId: privateData.data?.mercadopago_account_id,
        canReceive: canReceive.data,
        failed: Boolean(privateData.error || canReceive.error),
      })}
      accountNotice={parseAccountNotice(cuenta)}
    />
  );
}
