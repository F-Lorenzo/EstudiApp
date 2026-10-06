import { redirect } from "next/navigation";
import { TeacherAvailability } from "@/components/teacher-availability";
import { getViewer } from "@/lib/auth/viewer";
import {
  addDays,
  dayStart,
  keyFromIso,
  MAX_WEEKS_AHEAD,
  mondayOf,
} from "@/lib/availability/slots";
import { todayAR } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Tu disponibilidad" };

export default async function DisponibilidadPage({
  searchParams,
}: {
  searchParams: Promise<{ semana?: string | string[] }>;
}) {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");

  // `?semana=` es el desfase en semanas respecto de la actual (0 a MAX_WEEKS_AHEAD).
  const raw = (await searchParams).semana;
  const requested = Number(Array.isArray(raw) ? raw[0] : raw);
  const week = Number.isInteger(requested)
    ? Math.min(MAX_WEEKS_AHEAD, Math.max(0, requested))
    : 0;

  const today = todayAR();
  const weekStart = addDays(mondayOf(today), week * 7);
  const nextWeekStart = addDays(weekStart, 7);

  const supabase = await createClient();
  const [{ data: tutor }, { data: rows, error }] = await Promise.all([
    supabase
      .from("tutor_profiles")
      .select("verification_status")
      .eq("id", viewer.id)
      .single<{ verification_status: string }>(),
    supabase
      .from("availability_slots")
      .select("starts_at, is_booked")
      .eq("tutor_id", viewer.id)
      .gte("starts_at", dayStart(weekStart).toISOString())
      .lt("starts_at", dayStart(nextWeekStart).toISOString())
      .returns<{ starts_at: string; is_booked: boolean }[]>(),
  ]);

  const slots: Record<string, "free" | "booked"> = {};
  for (const row of rows ?? []) {
    slots[keyFromIso(row.starts_at)] = row.is_booked ? "booked" : "free";
  }

  return (
    <TeacherAvailability
      week={week}
      weekStart={weekStart}
      today={today}
      now={new Date().getTime()}
      status={tutor?.verification_status ?? "pendiente"}
      slots={slots}
      loadFailed={Boolean(error)}
    />
  );
}
