import { redirect } from "next/navigation";
import { TeacherAvailability } from "@/components/teacher-availability";
import { getViewer } from "@/lib/auth/viewer";
import { todayAR } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Tu disponibilidad" };

export default async function DisponibilidadPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");

  const supabase = await createClient();
  const { data: tutor } = await supabase
    .from("tutor_profiles")
    .select("verification_status")
    .eq("id", viewer.id)
    .single<{ verification_status: string }>();

  // Lunes de la semana actual y posición de hoy (lunes = 0).
  const today = new Date(`${todayAR()}T12:00:00`);
  const offset = (today.getDay() + 6) % 7;
  const monday = new Date(today);
  monday.setDate(today.getDate() - offset);

  return (
    <TeacherAvailability
      weekStart={monday.toISOString().slice(0, 10)}
      todayIndex={offset < 5 ? offset : -1}
      status={tutor?.verification_status ?? "pendiente"}
    />
  );
}
