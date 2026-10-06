import Link from "next/link";
import { notFound } from "next/navigation";
import { DecisionPanel } from "@/components/admin-pages";
import { Avatar, Badge, PageHeading } from "@/components/ui";
import { VerificationStatusBanner } from "@/components/verification-status-banner";
import { longDate, money } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { getTutorDetail } from "@/lib/tutors/queries";

export const metadata = { title: "Revisar solicitud" };

export default async function DetalleDocentePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: tutor } = await getTutorDetail(supabase, id);

  if (!tutor) notFound();

  const name = tutor.profiles?.full_name || "Docente";
  const subjectNames = (tutor.tutor_subjects ?? [])
    .map((row) => row.subjects?.name)
    .filter((subject): subject is string => Boolean(subject));
  const credentialIsLink =
    !!tutor.credential_url && /^https?:\/\//i.test(tutor.credential_url);

  return (
    <div className="mgmt-page">
      <Link
        href={
          tutor.verification_status === "aprobado"
            ? "/admin/docentes/activos"
            : "/admin/docentes/pendientes"
        }
        className="mgmt-back-link"
      >
        {tutor.verification_status === "aprobado"
          ? "← Volver a docentes"
          : "← Volver a solicitudes"}
      </Link>
      <PageHeading
        eyebrow="FICHA DOCENTE"
        title="Una nueva forma de enseñar."
        description={`Se registró el ${longDate(tutor.created_at)}. Revisá la información antes de tomar una decisión.`}
      />
      <VerificationStatusBanner
        status={tutor.verification_status}
        reason={tutor.verification_reason}
      />
      <div className="mgmt-request-detail-layout">
        <div className="mgmt-request-detail">
          <div className="mgmt-candidate-header">
            <Avatar name={name} src={tutor.profiles?.avatar_url ?? undefined} />
            <div>
              <h2>{name}</h2>
              <p>{subjectNames.join(", ") || "Sin materias cargadas"}</p>
            </div>
            <Badge
              tone={
                tutor.verification_status === "aprobado"
                  ? "green"
                  : tutor.verification_status === "rechazado"
                    ? "muted"
                    : "orange"
              }
            >
              {tutor.verification_status === "aprobado"
                ? "Aprobada"
                : tutor.verification_status === "rechazado"
                  ? "Rechazada"
                  : "Pendiente de revisión"}
            </Badge>
          </div>
          <section>
            <span className="mgmt-small-label">SU PRESENTACIÓN</span>
            <p className="mgmt-candidate-bio">
              {tutor.bio ? `“${tutor.bio}”` : "Todavía no escribió su presentación."}
            </p>
          </section>
          <dl className="mgmt-candidate-facts">
            <div>
              <dt>Formación</dt>
              <dd>{tutor.nivel_academico || "—"}</dd>
            </div>
            <div>
              <dt>Tarifa por clase</dt>
              <dd>{tutor.tarifa_por_clase ? money(Number(tutor.tarifa_por_clase)) : "—"}</dd>
            </div>
            <div>
              <dt>Contacto de verificación</dt>
              <dd>{tutor.contacto_verificacion || "—"}</dd>
            </div>
            <div>
              <dt>Respaldo</dt>
              <dd>
                {credentialIsLink ? (
                  <a
                    href={tutor.credential_url!}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Ver adjunto ↗
                  </a>
                ) : (
                  tutor.credential_url || "—"
                )}
              </dd>
            </div>
          </dl>
          <section>
            <span className="mgmt-small-label">MATERIAS</span>
            <div className="mgmt-tags">
              {subjectNames.length ? (
                subjectNames.map((subject) => (
                  <Badge key={subject} tone="green">
                    {subject}
                  </Badge>
                ))
              ) : (
                <span>—</span>
              )}
            </div>
          </section>
        </div>
        <DecisionPanel
          tutorId={tutor.id}
          status={tutor.verification_status}
          reason={tutor.verification_reason}
        />
      </div>
    </div>
  );
}
