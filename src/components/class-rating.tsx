"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { FieldError } from "@/components/field-error";
import { Avatar, Icon } from "@/components/ui";
import { rateClass } from "@/app/alumno/historial/actions";
import { initialActionState } from "@/lib/validation/form-state";
import { RATING_COMMENT_MAX } from "@/lib/validation/rating";

const DESCRIPTIONS = [
  "Elegí una puntuación",
  "Necesita mejorar",
  "Podría haber sido mejor",
  "Una buena experiencia",
  "Muy buena clase",
  "¡Una gran experiencia!",
];

/**
 * Calificación de una clase completada: muestra la que ya dejó el alumno o el botón que abre el formulario.
 * Queda montado aunque la página se actualice al guardar (la acción revalida la ruta), así el agradecimiento
 * sigue a la vista.
 *
 *  - `row`: celda del historial (enlace de texto).
 *  - `room`: pantalla de la sala al terminar la clase (botón sobre fondo oscuro; el formulario se abre solo).
 */
export function ClassRating({
  bookingId,
  tutorName,
  tutorPhoto,
  score,
  canRate,
  variant,
}: {
  bookingId: string;
  tutorName: string;
  tutorPhoto: string | null;
  score: number | null;
  canRate: boolean;
  variant: "row" | "room";
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, formAction, pending] = useActionState(rateClass.bind(null, bookingId), initialActionState);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const rated = state.success === true;
  const showForm = canRate && score == null;

  // Al terminar la clase, el formulario se abre solo una vez: si la persona lo cierra, no vuelve a aparecer.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (variant !== "room" || !showForm || autoOpened.current) return;
    autoOpened.current = true;
    dialog.current?.showModal();
  }, [variant, showForm]);

  const firstName = tutorName.split(" ")[0];
  const shownScore = score ?? (rated ? rating : null);

  return (
    <>
      {shownScore != null ? (
        <span className="stu-review-score" aria-label={`Calificaste la clase con ${shownScore} de 5 estrellas`}>
          <Icon name="star" size={16} />
          {shownScore.toFixed(1).replace(".", ",")}
        </span>
      ) : showForm ? (
        <button
          type="button"
          className={variant === "room" ? "stu-button stu-button-outline" : "stu-text-link stu-rate-link"}
          onClick={() => dialog.current?.showModal()}
        >
          {variant === "room" ? "Calificar la clase" : <><Icon name="star" size={16} /> Calificar</>}
        </button>
      ) : (
        <span />
      )}
      {(showForm || rated) && (
        <dialog ref={dialog} className="stu-rating-modal" aria-labelledby={`stu-rating-title-${bookingId}`}>
          <button
            type="button"
            className="stu-modal-close stu-icon-button"
            aria-label="Cerrar calificación"
            onClick={() => dialog.current?.close()}
          >
            <Icon name="x" size={20} />
          </button>
          {rated ? (
            <div className="stu-rating-thanks" role="status">
              <div className="stu-result-mark">
                <Icon name="check" size={32} />
              </div>
              <h2 id={`stu-rating-title-${bookingId}`}>Tu experiencia cuenta.</h2>
              <p>
                Guardamos tu calificación. Ayuda a otros estudiantes a elegir y a {firstName} a seguir mejorando.
              </p>
              <button type="button" className="stu-button" onClick={() => dialog.current?.close()}>
                Listo
              </button>
            </div>
          ) : (
            <form action={formAction}>
              <Avatar name={tutorName} src={tutorPhoto ?? undefined} size={64} />
              <span className="stu-eyebrow">UN MOMENTO ANTES DE IRTE</span>
              <h2 id={`stu-rating-title-${bookingId}`}>¿Cómo estuvo tu clase?</h2>
              <p>Contanos cómo fue aprender con {firstName}. Tu opinión se publica en su perfil con tu nombre y la inicial de tu apellido.</p>
              <input type="hidden" name="score" value={rating || ""} />
              <div className="stu-rating-stars" role="group" aria-label="Calificación de la clase">
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    type="button"
                    key={value}
                    aria-label={`${value} ${value === 1 ? "estrella" : "estrellas"}`}
                    aria-pressed={rating === value}
                    className={value <= rating ? "is-selected" : ""}
                    onClick={() => setRating(value)}
                  >
                    <Icon name="star" size={35} />
                  </button>
                ))}
              </div>
              <span className="stu-rating-description" aria-live="polite">
                {DESCRIPTIONS[rating]}
              </span>
              <FieldError messages={state.fieldErrors?.score} />
              <label className="stu-field">
                <span>
                  Tu comentario <small>Opcional</small>
                </span>
                <textarea
                  name="comment"
                  rows={3}
                  maxLength={RATING_COMMENT_MAX}
                  placeholder="¿Qué te ayudó a entender mejor?"
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  aria-invalid={state.fieldErrors?.comment ? true : undefined}
                />
                <FieldError messages={state.fieldErrors?.comment} />
              </label>
              {state.error && (
                <p className="stu-field-error" role="alert">
                  {state.error}
                </p>
              )}
              <button type="submit" className="stu-button stu-wide-button" disabled={!rating || pending}>
                {pending ? "Enviando…" : "Enviar valoración"} <Icon name="arrow-right" size={18} />
              </button>
              <button type="button" className="stu-rating-skip" onClick={() => dialog.current?.close()}>
                Ahora no
              </button>
            </form>
          )}
        </dialog>
      )}
    </>
  );
}
