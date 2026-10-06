import { TeacherOnboarding } from "@/components/teacher-onboarding";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Tu perfil profesional" };

export default async function PerfilDocentePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [
    { data: profile },
    { data: tutorProfile },
    { data: subjects },
    { data: tutorSubjects },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name, avatar_url")
      .eq("id", user!.id)
      .single(),
    supabase
      .from("tutor_profiles")
      .select(
        "bio, nivel_academico, credential_url, tarifa_por_clase, contacto_verificacion, verification_status, verification_reason",
      )
      .eq("id", user!.id)
      .single(),
    supabase.from("subjects").select("id, name").order("name"),
    supabase.from("tutor_subjects").select("subject_id").eq("tutor_id", user!.id),
  ]);

  return (
    <TeacherOnboarding
      values={{
        fullName: profile?.full_name ?? "",
        avatarUrl: profile?.avatar_url ?? "",
        bio: tutorProfile?.bio ?? "",
        nivelAcademico: tutorProfile?.nivel_academico ?? "",
        credentialUrl: tutorProfile?.credential_url ?? "",
        tarifaPorClase: Number(tutorProfile?.tarifa_por_clase) || 0,
        contactoVerificacion: tutorProfile?.contacto_verificacion ?? "",
        selectedSubjectIds: (tutorSubjects ?? []).map((row) => row.subject_id),
      }}
      subjects={subjects ?? []}
      status={tutorProfile?.verification_status ?? "pendiente"}
      reason={tutorProfile?.verification_reason ?? null}
    />
  );
}
