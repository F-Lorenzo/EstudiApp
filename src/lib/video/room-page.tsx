import { notFound, redirect } from "next/navigation";
import { ClassRoom } from "@/components/class-room";
import { getViewer } from "@/lib/auth/viewer";
import { syncBookings } from "@/lib/bookings/sync";
import { createClient } from "@/lib/supabase/server";
import { getRoomAccess } from "./room-access";
import { createDailyClient } from "./runtime";

/**
 * La página de la sala, igual para el alumno (`/alumno/sala/[id]`) y para el docente (`/docente/sala/[id]`). Cada
 * una pasa su rol: si quien abre la página no es esa parte de la reserva, la sala «no existe».
 */
export async function RoomPage({ bookingId, role }: { bookingId: string; role: "alumno" | "docente" }) {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (viewer.role !== role) notFound();

  const supabase = await createClient();
  // Pone al día el estado (una clase que terminó pasa a «completada») antes de decidir.
  await syncBookings(supabase);
  const access = await getRoomAccess({ supabase, daily: createDailyClient() }, { bookingId, viewer });
  if (access.state === "not_found") notFound();
  return <ClassRoom access={access} />;
}
