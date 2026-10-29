"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { decideAppeal } from "@/app/admin/resenas/actions";
import { FieldError } from "@/components/field-error";
import { Badge, EmptyState, PageHeading } from "@/components/ui";
import type { AdminAppeal } from "@/lib/ratings/appeals";
import { APPEAL_TEXT_MAX } from "@/lib/validation/appeal";
import { initialActionState } from "@/lib/validation/form-state";

/** Reseñas apeladas por los docentes (migración 0027): primero las pendientes, después las decididas. */
export function AdminAppeals({ appeals, loadFailed }: { appeals: AdminAppeal[]; loadFailed: boolean }) {
  const pending = appeals.filter((a) => a.status === "pendiente");
  const decided = appeals.filter((a) => a.status !== "pendiente");
  return (
    <div className="mgmt-page">
      <PageHeading
        eyebrow="RESEÑAS APELADAS"
        title="Reseñas justas para todos."
        description="Un docente puede apelar una vez cada reseña de 1 o 2 estrellas. Si aceptás, la reseña se quita: deja de mostrarse y de contar en su promedio, su nivel y las métricas. Si rechazás, le explicás por qué."
      >
        <Badge tone={pending.length ? "orange" : "muted"}>
          {pending.length} {pending.length === 1 ? "pendiente" : "pendientes"}
        </Badge>
      </PageHeading>
      {loadFailed ? (
        <EmptyState title="No pudimos cargar las apelaciones." description="Hubo un problema de nuestro lado. Actualizá la página en un momento." />
      ) : (
        <>
          <section className="mgmt-panel">
            <div className="mgmt-section-heading">
              <h2>Por decidir</h2>
            </div>
            {pending.length ? (
              <ul className="mgmt-review-list">
                {pending.map((appeal) => (
                  <AppealItem key={appeal.id} appeal={appeal} />
                ))}
              </ul>
            ) : (
              <EmptyState title="No hay apelaciones pendientes" description="Cuando un docente apele una reseña, aparece acá." />
            )}
          </section>
          {decided.length > 0 && (
            <section className="mgmt-panel mgmt-reviews-section">
              <div className="mgmt-section-heading">
                <h2>Decididas</h2>
              </div>
              <ul className="mgmt-review-list">
                {decided.map((appeal) => (
                  <AppealItem key={appeal.id} appeal={appeal} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      <div className="mgmt-list-footnote">
        <span>Cada decisión queda en el registro de acciones.</span>
        <Link href="/admin/registro">Ver el registro de acciones ↗</Link>
      </div>
    </div>
  );
}

function AppealItem({ appeal }: { appeal: AdminAppeal }) {
  return (
    <li className="mgmt-review-item">
      <div className="mgmt-review-top">
        <span className="mgmt-review-stars" role="img" aria-label={`${appeal.score} de 5 estrellas`}>
          {[1, 2, 3, 4, 5].map((n) => (
            <span key={n} aria-hidden="true" className={n <= appeal.score ? "is-on" : ""}>
              ★
            </span>
          ))}
        </span>
        <span className="mgmt-review-meta">
          <strong>{appeal.studentName}</strong> sobre{" "}
          <Link href={`/admin/docentes/${appeal.tutorId}`}>{appeal.tutorName}</Link> · clase del {appeal.classDay}
        </span>
        {appeal.status === "aceptada" ? (
          <Badge tone="green">Quitada</Badge>
        ) : appeal.status === "rechazada" ? (
          <Badge tone="muted">Rechazada</Badge>
        ) : (
          <Badge tone="orange">Apelada {appeal.ago}</Badge>
        )}
      </div>
      {appeal.comment ? (
        <p className="mgmt-review-comment">«{appeal.comment}»</p>
      ) : (
        <p className="mgmt-review-comment is-empty">Sin comentario.</p>
      )}
      <div className="mgmt-review-appeal">
        <p>
          <strong>Motivo del docente:</strong> {appeal.reason}
        </p>
        {appeal.status !== "pendiente" && (
          <p>
            {appeal.status === "aceptada" ? "Aceptada" : "Rechazada"}
            {appeal.decidedBy ? ` por ${appeal.decidedBy}` : ""}
            {appeal.decidedAgo ? ` ${appeal.decidedAgo}` : ""}.
            {appeal.response ? (
              <>
                {" "}
                <strong>Respuesta:</strong> {appeal.response}
              </>
            ) : null}
          </p>
        )}
      </div>
      {appeal.status === "pendiente" && <DecisionForms appealId={appeal.id} />}
    </li>
  );
}

function DecisionForms({ appealId }: { appealId: string }) {
  const [mode, setMode] = useState<"idle" | "accept" | "reject">("idle");
  if (mode === "idle") {
    return (
      <div className="mgmt-review-form-actions">
        <button type="button" className="mgmt-button mgmt-button-small" onClick={() => setMode("accept")}>
          Quitar la reseña
        </button>
        <button type="button" className="mgmt-button mgmt-button-secondary mgmt-button-small" onClick={() => setMode("reject")}>
          Rechazar la apelación
        </button>
      </div>
    );
  }
  return <DecisionForm appealId={appealId} accept={mode === "accept"} onCancel={() => setMode("idle")} />;
}

function DecisionForm({ appealId, accept, onCancel }: { appealId: string; accept: boolean; onCancel: () => void }) {
  const [state, formAction, pending] = useActionState(decideAppeal.bind(null, appealId, accept), initialActionState);
  return (
    <form action={formAction} className="mgmt-review-form">
      <label className="mgmt-field">
        {accept ? "Nota para el docente (opcional)" : "Respuesta para el docente"}
        <textarea
          name="response"
          rows={3}
          required={!accept}
          maxLength={APPEAL_TEXT_MAX}
          defaultValue={state.values?.response}
          placeholder={accept ? "Por ejemplo: la reseña no describe la clase." : "Por ejemplo: la reseña describe la clase y no incumple las normas."}
          aria-invalid={state.fieldErrors?.response ? true : undefined}
        />
        <FieldError messages={state.fieldErrors?.response} />
      </label>
      <p className="mgmt-field-hint">
        {accept
          ? "La reseña se quita para siempre: deja de mostrarse y de contar, y el alumno no puede volver a calificar esa clase."
          : "La reseña sigue publicada. El docente ve tu respuesta y no puede volver a apelarla."}
      </p>
      {state.error && (
        <p className="mgmt-field-error" role="alert">
          {state.error}
        </p>
      )}
      <div className="mgmt-review-form-actions">
        <button
          type="submit"
          className={accept ? "mgmt-button mgmt-button-rust mgmt-button-small" : "mgmt-button mgmt-button-small"}
          disabled={pending}
        >
          {pending ? "Guardando…" : accept ? "Quitar la reseña" : "Rechazar la apelación"}
        </button>
        <button type="button" className="mgmt-text-button" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
