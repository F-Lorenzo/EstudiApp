"use client";

import { useActionState, useState } from "react";
import { appealReview } from "@/app/docente/resenas/actions";
import { FieldError } from "@/components/field-error";
import { Badge, EmptyState, Icon, PageHeading } from "@/components/ui";
import { formatRate } from "@/lib/admin/commission";
import { ratingAR } from "@/lib/format";
import { missingForNext, type MyLevel, type MyReview } from "@/lib/ratings/appeals";
import { APPEAL_TEXT_MAX } from "@/lib/validation/appeal";
import { initialActionState } from "@/lib/validation/form-state";

/** «Mis reseñas» del docente: su nivel (migración 0027) y cada reseña, con la apelación de las de 1 o 2 estrellas. */
export function TeacherReviews({
  level,
  reviews,
  loadFailed,
}: {
  level: MyLevel | null;
  reviews: MyReview[];
  loadFailed: boolean;
}) {
  return (
    <div className="mgmt-page">
      <PageHeading
        eyebrow="MIS RESEÑAS"
        title="Tu reputación, a la vista."
        description="Lo que opinan tus alumnos y el nivel que te da. Cuanto mejores referencias, menos comisión pagás."
      />
      {level ? (
        <LevelCard level={level} />
      ) : (
        <EmptyState title="No pudimos cargar tu nivel." description="Hubo un problema de nuestro lado. Actualizá la página en un momento." />
      )}
      <section className="mgmt-panel mgmt-reviews-section">
        <div className="mgmt-section-heading">
          <div>
            <h2>Opiniones de tus alumnos</h2>
            <p>
              Podés apelar una vez cada reseña de 1 o 2 estrellas. Si la administración acepta tu apelación, la reseña se
              quita: deja de mostrarse y de contar para tu promedio y tu nivel.
            </p>
          </div>
        </div>
        {loadFailed ? (
          <EmptyState title="No pudimos cargar tus reseñas." description="Hubo un problema de nuestro lado. Actualizá la página en un momento." />
        ) : reviews.length ? (
          <ul className="mgmt-review-list">
            {reviews.map((review) => (
              <ReviewItem key={review.ratingId} review={review} />
            ))}
          </ul>
        ) : (
          <EmptyState
            title="Todavía no tenés reseñas"
            description="Cuando un alumno califique una clase con vos, su opinión aparece acá."
          />
        )}
      </section>
    </div>
  );
}

function LevelCard({ level }: { level: MyLevel }) {
  const missing = missingForNext(level);
  return (
    <section className="mgmt-level-card" aria-labelledby="mgmt-level-title">
      <div className="mgmt-level-main">
        <span className="mgmt-small-label">TU NIVEL</span>
        <h2 id="mgmt-level-title">{level.name}</h2>
        <p>
          {level.reviews === 0
            ? "Todavía no tenés reseñas que cuenten."
            : `${level.reviews} ${level.reviews === 1 ? "reseña que cuenta" : "reseñas que cuentan"}, con un promedio de ${ratingAR(level.average ?? 0)}.`}{" "}
          Cuentan las reseñas de clases dadas y pagas, una por alumno.
        </p>
      </div>
      <dl className="mgmt-level-facts">
        <div>
          <dt>Tu comisión hoy</dt>
          <dd>{formatRate(level.rate)}</dd>
        </div>
        <div>
          <dt>{level.next ? `Siguiente: ${level.next.name}` : "Siguiente nivel"}</dt>
          <dd>
            {level.next ? (
              <>
                {formatRate(level.next.rate)}
                <small>{missing.length ? `Te faltan ${missing.join(" y ")}.` : "Ya casi."}</small>
              </>
            ) : (
              <small>Llegaste al nivel más alto.</small>
            )}
          </dd>
        </div>
      </dl>
      {!level.enabled && (
        <p className="mgmt-level-note">
          La comisión por niveles todavía no está activa: por ahora todos los docentes pagan la comisión base.
        </p>
      )}
    </section>
  );
}

function Stars({ score }: { score: number }) {
  return (
    <span className="mgmt-review-stars" role="img" aria-label={`${score} de 5 estrellas`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} aria-hidden="true" className={n <= score ? "is-on" : ""}>
          ★
        </span>
      ))}
    </span>
  );
}

function ReviewItem({ review }: { review: MyReview }) {
  const [open, setOpen] = useState(false);
  return (
    <li className={`mgmt-review-item ${review.removed ? "is-removed" : ""}`}>
      <div className="mgmt-review-top">
        <Stars score={review.score} />
        <span className="mgmt-review-meta">
          <strong>{review.author}</strong> · clase del {review.classDay} · {review.ago}
        </span>
        {review.removed ? (
          <Badge tone="muted">Quitada</Badge>
        ) : review.appeal?.status === "pendiente" ? (
          <Badge tone="orange">Apelación en revisión</Badge>
        ) : review.appeal?.status === "rechazada" ? (
          <Badge tone="muted">Apelación rechazada</Badge>
        ) : null}
      </div>
      {review.comment ? <p className="mgmt-review-comment">«{review.comment}»</p> : <p className="mgmt-review-comment is-empty">Sin comentario.</p>}
      {review.appeal && (
        <div className="mgmt-review-appeal">
          <p>
            <strong>Tu apelación:</strong> {review.appeal.reason}
          </p>
          {review.removed && <p>La administración aceptó tu apelación{review.appeal.decidedAgo ? ` ${review.appeal.decidedAgo}` : ""}: la reseña ya no cuenta.</p>}
          {review.appeal.response && (
            <p>
              <strong>Respuesta de EstudiApp:</strong> {review.appeal.response}
            </p>
          )}
        </div>
      )}
      {review.canAppeal &&
        (open ? (
          <AppealForm ratingId={review.ratingId} onCancel={() => setOpen(false)} />
        ) : (
          <button type="button" className="mgmt-text-button mgmt-review-appeal-button" onClick={() => setOpen(true)}>
            <Icon name="shield" size={16} /> Apelar esta reseña
          </button>
        ))}
    </li>
  );
}

function AppealForm({ ratingId, onCancel }: { ratingId: string; onCancel: () => void }) {
  const [state, formAction, pending] = useActionState(appealReview.bind(null, ratingId), initialActionState);
  if (state.success) {
    return (
      <p className="mgmt-field-hint" role="status">
        Enviamos tu apelación. La administración la revisa y te mostramos acá lo que decida.
      </p>
    );
  }
  return (
    <form action={formAction} className="mgmt-review-form">
      <label className="mgmt-field">
        ¿Por qué la apelás?
        <textarea
          name="reason"
          rows={3}
          required
          minLength={10}
          maxLength={APPEAL_TEXT_MAX}
          defaultValue={state.values?.reason}
          placeholder="Por ejemplo: el alumno no se presentó a la clase, o la reseña no habla de la clase."
          aria-invalid={state.fieldErrors?.reason ? true : undefined}
        />
        <FieldError messages={state.fieldErrors?.reason} />
      </label>
      <p className="mgmt-field-hint">Se apela una sola vez. Lo lee solo el equipo de EstudiApp, no el alumno.</p>
      {state.error && (
        <p className="mgmt-field-error" role="alert">
          {state.error}
        </p>
      )}
      <div className="mgmt-review-form-actions">
        <button type="submit" className="mgmt-button mgmt-button-small" disabled={pending}>
          {pending ? "Enviando…" : "Enviar apelación"}
        </button>
        <button type="button" className="mgmt-text-button" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
