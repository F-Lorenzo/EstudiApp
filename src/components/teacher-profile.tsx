"use client";

import { useState } from "react";
import Link from "next/link";
import { Avatar, Badge, ButtonLink, Icon } from "@/components/ui";
import { money } from "@/lib/format";
import type { UserRole } from "@/lib/auth/roles";
import type { Teacher } from "@/lib/tutors/view";

/** Horario libre del docente; `label` ya viene formateado en hora de Argentina. */
export type ProfileSlot = {
  id: string;
  label: string;
};
export type ProfileReview = {
  score: number;
  comment: string | null;
  date: string;
};

export function TeacherProfile({
  teacher,
  slots,
  reviews,
  viewerRole,
}: {
  teacher: Teacher;
  slots: ProfileSlot[];
  reviews: ProfileReview[];
  /** `null` si no hay sesión. Solo alumnos (y visitantes) ven el botón de reserva. */
  viewerRole: UserRole | null;
}) {
  const [slotId, setSlotId] = useState(slots[0]?.id ?? "");
  const [expanded, setExpanded] = useState(false);
  const canBook = viewerRole === null || viewerRole === "alumno";
  const chosen = slots.find((slot) => slot.id === slotId);
  const bookingHref = `/alumno/reservar/${teacher.id}${
    chosen ? `?${new URLSearchParams({ slot: chosen.id })}` : ""
  }`;
  const visibleReviews = reviews.slice(0, expanded ? reviews.length : 2);

  return (
    <div className="pub-profile pub-container">
      <Link className="pub-back-link" href="/docentes">
        <Icon name="arrow-left" size={17} /> Volver a docentes
      </Link>
      <div className="pub-profile-layout">
        <div className="pub-profile-main">
          <section className="pub-profile-heading">
            <div className="pub-profile-avatar">
              <Avatar
                name={teacher.name}
                src={teacher.photo ?? undefined}
                size={150}
              />
              <span className="pub-verified">
                <Icon name="check" size={16} />
              </span>
            </div>
            <div>
              <Badge>Perfil verificado</Badge>
              <h1>{teacher.name}</h1>
              {teacher.title && <p>{teacher.title}</p>}
              <div className="pub-profile-rating">
                {teacher.rating > 0 ? (
                  <>
                    <Icon name="star" size={18} />
                    <strong>{teacher.rating.toFixed(1)}</strong>
                    <a href="#opiniones">
                      {reviews.length}{" "}
                      {reviews.length === 1 ? "opinión" : "opiniones"}
                    </a>
                  </>
                ) : (
                  <span>Nuevo en EstudiApp</span>
                )}
              </div>
            </div>
          </section>
          <nav className="pub-profile-tabs" aria-label="Secciones del perfil">
            <a href="#sobre-mi">Sobre mí</a>
            {teacher.title && <a href="#formacion">Formación</a>}
            <a href="#opiniones">Opiniones</a>
          </nav>
          <section id="sobre-mi" className="pub-profile-section">
            <p className="pub-eyebrow">APRENDER CON CONFIANZA</p>
            <h2>Entender cambia todo.</h2>
            <p>{teacher.bio || "Este docente todavía no escribió su presentación."}</p>
            {teacher.subjects.length > 0 && (
              <>
                <h3>Materias que podemos trabajar</h3>
                <div className="pub-subject-pills pub-profile-subjects">
                  {teacher.subjects.map((subject) => (
                    <span key={subject}>{subject}</span>
                  ))}
                </div>
              </>
            )}
            <div className="pub-method">
              <Icon name="book" size={25} />
              <div>
                <strong>Una clase pensada para vos</strong>
                <p>
                  Encuentros individuales y online. Podés compartir tu programa,
                  apuntes o guía de ejercicios antes de empezar.
                </p>
              </div>
            </div>
          </section>
          {teacher.title && (
            <section id="formacion" className="pub-profile-section">
              <h2>Experiencia que acompaña.</h2>
              <div className="pub-education">
                <div className="pub-education-icon">
                  <Icon name="graduation" size={28} />
                </div>
                <div>
                  <h3>{teacher.title}</h3>
                  {teacher.university && <p>{teacher.university}</p>}
                  <Badge tone="muted">Revisado por EstudiApp</Badge>
                </div>
              </div>
            </section>
          )}
          <section id="opiniones" className="pub-profile-section">
            <div className="pub-review-heading">
              <div>
                <p className="pub-eyebrow">DEL OTRO LADO DE LA CLASE</p>
                <h2>Lo que dicen sus estudiantes.</h2>
              </div>
              {reviews.length > 0 && (
                <div className="pub-review-score">
                  <strong>{teacher.rating.toFixed(1)}</strong>
                  <span>
                    <Icon name="star" size={17} /> {reviews.length}{" "}
                    {reviews.length === 1 ? "opinión" : "opiniones"}
                  </span>
                </div>
              )}
            </div>
            {reviews.length === 0 && (
              <p className="pub-no-reviews">
                Todavía no tiene opiniones. Las que dejen sus estudiantes
                después de cada clase van a aparecer acá.
              </p>
            )}
            {visibleReviews.map((review, index) => (
              <article className="pub-review" key={index}>
                <div className="pub-review-person">
                  <Avatar name="Estudiante" size={40} />
                  <div>
                    <strong>Estudiante de EstudiApp</strong>
                  </div>
                  <time>{review.date}</time>
                </div>
                <div
                  className="pub-review-stars"
                  aria-label={`${review.score} de 5 estrellas`}
                >
                  {[1, 2, 3, 4, 5].map((number) => (
                    <Icon
                      name="star"
                      size={14}
                      key={number}
                      className={number <= review.score ? "" : "pub-star-off"}
                    />
                  ))}
                </div>
                {review.comment && <p>{review.comment}</p>}
              </article>
            ))}
            {reviews.length > 2 && (
              <button
                type="button"
                className="pub-text-button"
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? "Ver menos opiniones" : "Ver más opiniones"}
                <Icon name={expanded ? "minus" : "plus"} size={15} />
              </button>
            )}
          </section>
        </div>
        <aside className="pub-booking-panel">
          <div className="pub-booking-top">
            <span>Tu próxima clase, más cerca.</span>
            <p>
              <strong>{money(teacher.price)}</strong> / clase
            </p>
            <div>
              <Icon name="video" size={15} /> <span>Online, uno a uno</span>
            </div>
          </div>
          {slots.length > 0 ? (
            <fieldset>
              <legend>Próximos horarios</legend>
              {slots.map((slot) => (
                <label
                  className={`pub-slot ${slotId === slot.id ? "pub-slot-selected" : ""}`}
                  key={slot.id}
                >
                  <input
                    type="radio"
                    name="profile-slot"
                    value={slot.id}
                    checked={slotId === slot.id}
                    onChange={() => setSlotId(slot.id)}
                  />
                  <Icon name="calendar" size={17} />
                  <span>{slot.label}</span>
                  <span className="pub-slot-radio" />
                </label>
              ))}
            </fieldset>
          ) : (
            <p className="pub-no-slots">
              Todavía no publicó horarios. Volvé a mirar pronto.
            </p>
          )}
          <p className="pub-timezone">Hora de Argentina (GMT−3)</p>
          {canBook ? (
            <>
              <ButtonLink href={bookingHref}>
                Reservar una clase <Icon name="arrow-right" size={17} />
              </ButtonLink>
              <div className="pub-booking-note">
                <Icon name="shield" size={18} />
                <p>Elegís el horario y revisás el resumen antes de confirmar.</p>
              </div>
            </>
          ) : (
            <div className="pub-booking-note">
              <Icon name="info" size={18} />
              <p>Estás viendo el perfil público de este docente.</p>
            </div>
          )}
        </aside>
      </div>
      {canBook && (
        <div className="pub-mobile-reserve">
          <div>
            <strong>{money(teacher.price)}</strong>
            <span> / clase</span>
          </div>
          <ButtonLink href={bookingHref}>
            Reservar clase <Icon name="arrow-right" size={15} />
          </ButtonLink>
        </div>
      )}
    </div>
  );
}
