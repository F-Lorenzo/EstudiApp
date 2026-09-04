import { VerificationStatusBanner } from "@/components/verification-status-banner";
import { getTutorProfile, listSubjects } from "@/lib/mock/queries";
import { TUTOR_SUBJECTS } from "@/lib/mock/data";
import { getMockSession } from "@/lib/mock/session";
import { TutorProfileForm } from "./tutor-profile-form";

export default async function PerfilDocentePage() {
  const profile = await getMockSession();
  const tutorProfile = profile ? getTutorProfile(profile.id) : null;
  const subjects = listSubjects();
  const selectedSubjectIds = profile
    ? TUTOR_SUBJECTS.filter((ts) => ts.tutor_id === profile.id).map((ts) => ts.subject_id)
    : [];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Mi perfil docente</h1>

      <VerificationStatusBanner
        status={tutorProfile?.verification_status ?? "pendiente"}
        reason={tutorProfile?.verification_reason}
      />

      <TutorProfileForm
        email={profile?.email ?? ""}
        fullName={profile?.full_name ?? ""}
        avatarUrl={profile?.avatar_url ?? ""}
        bio={tutorProfile?.bio ?? ""}
        nivelAcademico={tutorProfile?.nivel_academico ?? ""}
        credentialUrl={tutorProfile?.credential_url ?? ""}
        tarifaPorClase={tutorProfile?.tarifa_por_clase ?? 0}
        contactoVerificacion={tutorProfile?.contacto_verificacion ?? ""}
        subjects={subjects}
        selectedSubjectIds={selectedSubjectIds}
      />
    </div>
  );
}
