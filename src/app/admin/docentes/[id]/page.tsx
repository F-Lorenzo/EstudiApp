import { notFound } from "next/navigation";
import { VerificationStatusBanner } from "@/components/verification-status-banner";
import { getTutorDetail } from "@/lib/mock/queries";
import { approveTutor } from "./actions";
import { RejectForm } from "./reject-form";

export default async function DetalleDocentePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tutor = getTutorDetail(id);

  if (!tutor) {
    notFound();
  }

  const subjectNames = (tutor.tutor_subjects ?? [])
    .map((row) => row.subjects?.name)
    .filter((name): name is string => Boolean(name));

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-xl font-semibold">{tutor.profiles?.full_name ?? "Docente"}</h1>

      <VerificationStatusBanner status={tutor.verification_status} reason={tutor.verification_reason} />

      <dl className="space-y-3 text-sm">
        <div>
          <dt className="font-medium">Biografía</dt>
          <dd className="text-neutral-600">{tutor.bio}</dd>
        </div>
        <div>
          <dt className="font-medium">Materias</dt>
          <dd className="text-neutral-600">
            {subjectNames.length > 0 ? subjectNames.join(", ") : "—"}
          </dd>
        </div>
        <div>
          <dt className="font-medium">Nivel académico</dt>
          <dd className="text-neutral-600">{tutor.nivel_academico ?? "—"}</dd>
        </div>
        <div>
          <dt className="font-medium">Adjunto / respaldo</dt>
          <dd className="text-neutral-600">
            {tutor.credential_url ? (
              <a href={tutor.credential_url} className="underline" target="_blank">
                Ver adjunto
              </a>
            ) : (
              "—"
            )}
          </dd>
        </div>
        <div>
          <dt className="font-medium">Tarifa por clase</dt>
          <dd className="text-neutral-600">${tutor.tarifa_por_clase}</dd>
        </div>
        <div>
          <dt className="font-medium">Contacto de verificación</dt>
          <dd className="text-neutral-600">{tutor.contacto_verificacion ?? "—"}</dd>
        </div>
      </dl>

      {tutor.verification_status === "pendiente" && (
        <div className="flex flex-col gap-4">
          <form action={approveTutor.bind(null, tutor.id)}>
            <button
              type="submit"
              className="border-2 border-black bg-white px-3 py-2 text-black hover:bg-black hover:text-white"
            >
              Aprobar
            </button>
          </form>
          <RejectForm tutorId={tutor.id} />
        </div>
      )}
    </div>
  );
}
