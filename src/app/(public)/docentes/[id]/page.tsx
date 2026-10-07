import { notFound } from "next/navigation";
import {
  TeacherProfile,
  type ProfileReview,
  type ProfileSlot,
} from "@/components/teacher-profile";
import { getViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";
import { getPublicTeacher } from "@/lib/tutors/public";

const TIME_ZONE = "America/Argentina/Buenos_Aires";
const slotFormat = new Intl.DateTimeFormat("es-AR", {
  timeZone: TIME_ZONE,
  weekday: "long",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const dateFormat = new Intl.DateTimeFormat("es-AR", {
  timeZone: TIME_ZONE,
  dateStyle: "medium",
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const teacher = await getPublicTeacher((await params).id);
  return { title: teacher?.name ?? "Docente no encontrado" };
}

export default async function PerfilPublicoDocentePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const teacher = await getPublicTeacher(id);
  if (!teacher) notFound();

  const supabase = await createClient();
  const [{ data: ratings }, { data: slots }, viewer] = await Promise.all([
    supabase
      .from("ratings")
      .select("score, comment, created_at")
      .eq("tutor_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("availability_slots")
      .select("id, starts_at")
      .eq("tutor_id", id)
      .eq("is_booked", false)
      .gt("starts_at", new Date().toISOString())
      .order("starts_at")
      .limit(5),
    getViewer(),
  ]);

  const reviews: ProfileReview[] = (ratings ?? []).map((rating) => ({
    score: rating.score,
    comment: rating.comment,
    date: dateFormat.format(new Date(rating.created_at)),
  }));
  const profileSlots: ProfileSlot[] = (slots ?? []).map((slot) => ({
    id: slot.id,
    label: slotFormat.format(new Date(slot.starts_at)),
  }));

  return (
    <TeacherProfile
      teacher={{ ...teacher, reviews: reviews.length }}
      slots={profileSlots}
      reviews={reviews}
      viewerRole={viewer?.role ?? null}
    />
  );
}
