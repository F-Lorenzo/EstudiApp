"use client";

import { useState } from "react";
import Link from "next/link";
import { Notice, Tabs } from "@/components/management-ui";
import {
  Badge,
  ButtonLink,
  EmptyState,
  PageHeading,
  SampleBanner,
} from "@/components/ui";
import { VerificationStatusBanner } from "@/components/verification-status-banner";
import type { TutorClass } from "@/lib/bookings/tutor-queries";
import { dayParts, isToday, longDate, timeAR, timeRange } from "@/lib/format";

export function TeacherDashboard({
  tutorId,
  status,
  reason,
  rating,
  upcoming,
  completed,
  nextOpenSlot,
  loadFailed,
}: {
  tutorId: string;
  status: string;
  reason: string | null;
  rating: number;
  upcoming: TutorClass[];
  completed: TutorClass[];
  nextOpenSlot: string | null;
  loadFailed: boolean;
}) {
  const [tab, setTab] = useState("Próximas clases");
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState("");
  const next = upcoming[0];
  const later = upcoming.slice(1, 4);

  return (
    <div className="mgmt-page">
      <PageHeading
        eyebrow="MI ESPACIO DOCENTE"
        title="Todo listo para enseñar."
        description="Tu agenda, tus clases y un poco más de claridad para el día."
      >
        <ButtonLink href="/docente/disponibilidad" variant="secondary">
          Administrar disponibilidad <span aria-hidden="true">↗</span>
        </ButtonLink>
      </PageHeading>
      <VerificationStatusBanner
        status={status}
        reason={reason}
        action={
          status === "aprobado"
            ? { href: `/docentes/${tutorId}`, label: "Ver mi perfil" }
            : {
                href: "/docente/perfil",
                label: status === "rechazado" ? "Corregir perfil" : "Ver mi perfil",
              }
        }
      />
      <div className="mgmt-summary-line">
        <span>
          <strong>{upcoming.length}</strong>{" "}
          {upcoming.length === 1 ? "clase próxima" : "clases próximas"}
        </span>
        <span>
          <strong>{completed.length}</strong>{" "}
          {completed.length === 1 ? "clase completada" : "clases completadas"}
        </span>
        <span>
          {rating > 0 ? (
            <>
              <strong>
                {rating.toFixed(1).replace(".", ",")}{" "}
                <span className="mgmt-star">★</span>
              </strong>{" "}
              valoración promedio
            </>
          ) : (
            "Todavía sin valoraciones"
          )}
        </span>
      </div>
      <Tabs
        items={["Próximas clases", "Historial", "Cuenta de cobro"]}
        value={tab}
        onChange={setTab}
      />
      {tab === "Próximas clases" && (
        <div className="mgmt-dashboard-columns">
          <div>
            {loadFailed ? (
              <EmptyState
                title="No pudimos cargar tus clases."
                description="Hubo un problema de nuestro lado. Actualizá la página en un momento."
              />
            ) : next ? (
              <>
                <div className="mgmt-section-heading">
                  <h2>Tu próxima clase</h2>
                  <span>{longDate(next.startsAt)}</span>
                </div>
                <article className="mgmt-next-class">
                  <div className="mgmt-next-top">
                    <span className="mgmt-live-dot">
                      {isToday(next.startsAt) ? "HOY · " : ""}
                      {timeRange(next.startsAt, next.endsAt)
                        .replace(" h", "")
                        .replace(" – ", " A ")}
                    </span>
                    <span className="mgmt-next-label">Clase individual</span>
                  </div>
                  <h3>Clase con un estudiante</h3>
                  <p>Online, uno a uno.</p>
                </article>
                {later.length > 0 && (
                  <>
                    <div className="mgmt-section-heading mgmt-section-heading-spaced">
                      <h2>Después, en tu agenda</h2>
                      <span>
                        {upcoming.length - 1}{" "}
                        {upcoming.length - 1 === 1 ? "clase más" : "clases más"}
                      </span>
                    </div>
                    {later.map((item) => {
                      const { weekday, day } = dayParts(item.startsAt);
                      return (
                        <article className="mgmt-agenda-row" key={item.id}>
                          <div className="mgmt-date-tile">
                            <span>{weekday.slice(0, 3).toUpperCase()}</span>
                            <strong>{day.padStart(2, "0")}</strong>
                          </div>
                          <div className="mgmt-agenda-info">
                            <strong>Clase individual</strong>
                            <span>{timeRange(item.startsAt, item.endsAt)}</span>
                          </div>
                        </article>
                      );
                    })}
                  </>
                )}
              </>
            ) : (
              <EmptyState
                title="Todavía no tenés clases reservadas"
                description="Cuando un estudiante reserve uno de tus horarios, la clase aparece acá."
              >
                <ButtonLink href="/docente/disponibilidad" variant="secondary">
                  Administrar disponibilidad
                </ButtonLink>
              </EmptyState>
            )}
          </div>
          <aside className="mgmt-margin-note">
            <span className="mgmt-small-label">UN BUEN HÁBITO</span>
            <div className="mgmt-note-art" aria-hidden="true">
              <span>∫</span>
              <i>f(x)</i>
              <b>→</b>
            </div>
            <h3>Una agenda clara también enseña.</h3>
            <p>
              Mantené tus horarios al día para que cada estudiante encuentre su
              momento.
            </p>
            <Link href="/docente/disponibilidad" className="mgmt-text-button">
              Abrir mi agenda <span aria-hidden="true">↗</span>
            </Link>
            {nextOpenSlot && (
              <div className="mgmt-note-footer">
                Próxima disponibilidad
                <br />
                <strong>
                  {dayParts(nextOpenSlot).weekday.replace(/^./, (c) =>
                    c.toUpperCase(),
                  )}{" "}
                  · {timeAR(nextOpenSlot)}
                </strong>
              </div>
            )}
          </aside>
        </div>
      )}
      {tab === "Historial" && (
        <section className="mgmt-panel">
          <div className="mgmt-section-heading">
            <div>
              <h2>Lo que ya compartiste</h2>
              <p>Tus clases completadas, de la más reciente a la más antigua.</p>
            </div>
            <Badge tone="green">
              {completed.length}{" "}
              {completed.length === 1 ? "clase" : "clases"}
            </Badge>
          </div>
          {completed.length ? (
            <div className="mgmt-table-wrap">
              <table className="mgmt-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Horario</th>
                    <th>Valoración</th>
                  </tr>
                </thead>
                <tbody>
                  {completed.map((row) => {
                    const { day, month } = dayParts(row.startsAt);
                    return (
                      <tr key={row.id}>
                        <td>
                          <strong>
                            {day} {month}
                          </strong>
                        </td>
                        <td>{timeRange(row.startsAt, row.endsAt)}</td>
                        <td>
                          {row.score != null ? (
                            <>
                              <span className="mgmt-star">★</span>{" "}
                              {row.score.toFixed(1).replace(".", ",")}
                            </>
                          ) : (
                            "Sin reseña"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="Todavía no completaste clases"
              description="Tus clases finalizadas van a quedar registradas acá."
            />
          )}
        </section>
      )}
      {tab === "Cuenta de cobro" && (
        <>
          <SampleBanner>
            La vinculación con Mercado Pago todavía no está conectada. Esta
            pantalla muestra cómo se verá: no se vincula ninguna cuenta real.
          </SampleBanner>
          <section className="mgmt-payment-panel">
            <div>
              <span className="mgmt-small-label">TUS CLASES, TUS COBROS</span>
              <h2>Enseñá con todo en orden.</h2>
              <p>
                Vinculá tu cuenta de Mercado Pago para recibir el pago de tus
                clases.
              </p>
              <ul className="mgmt-check-list">
                <li>Una cuenta a tu nombre</li>
                <li>El detalle de cada clase en tu historial</li>
                <li>Tu información siempre bajo tu control</li>
              </ul>
            </div>
            <div className="mgmt-payment-form">
              <div className="mgmt-payment-logo" aria-hidden="true">
                mp
              </div>
              <h3>Mercado Pago</h3>
              <Badge tone={connected ? "green" : "orange"}>
                {connected ? "Cuenta vinculada" : "Pendiente de vinculación"}
              </Badge>
              {connected ? (
                <>
                  <p>
                    Cuenta de muestra: <strong>{email}</strong>
                  </p>
                  <button
                    type="button"
                    className="mgmt-button mgmt-button-secondary"
                    onClick={() => {
                      setConnected(false);
                      setNotice("La cuenta de muestra quedó desvinculada.");
                    }}
                  >
                    Desvincular cuenta
                  </button>
                </>
              ) : connecting ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    setConnected(true);
                    setConnecting(false);
                    setNotice(
                      "Cuenta vinculada en esta vista de muestra. No se conectó una cuenta real de Mercado Pago.",
                    );
                  }}
                >
                  <label className="mgmt-field">
                    Email de la cuenta
                    <input
                      type="email"
                      required
                      placeholder="tu@email.com"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                    />
                  </label>
                  <button className="mgmt-button" type="submit">
                    Confirmar vinculación de muestra
                  </button>
                  <button
                    className="mgmt-text-button"
                    type="button"
                    onClick={() => setConnecting(false)}
                  >
                    Volver
                  </button>
                </form>
              ) : (
                <>
                  <p>La vinculación se realiza una sola vez.</p>
                  <button
                    type="button"
                    className="mgmt-button"
                    onClick={() => setConnecting(true)}
                  >
                    Vincular cuenta <span aria-hidden="true">↗</span>
                  </button>
                </>
              )}
              <small>No se realizan conexiones ni cobros reales.</small>
            </div>
          </section>
        </>
      )}
      <Notice message={notice} />
    </div>
  );
}
