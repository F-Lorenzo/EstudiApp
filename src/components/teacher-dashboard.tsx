"use client";

import { useState } from "react";
import Link from "next/link";
import { Tabs } from "@/components/management-ui";
import {
  Badge,
  ButtonLink,
  EmptyState,
  PageHeading,
} from "@/components/ui";
import { TeacherClassCancel } from "@/components/teacher-class-cancel";
import { VerificationStatusBanner } from "@/components/verification-status-banner";
import {
  PayoutAccountPanel,
  PayoutAccountReminder,
} from "@/app/docente/cuenta-de-cobro/payout-account-card";
import type { PayoutAccountView } from "@/app/docente/cuenta-de-cobro/state";
import type { TutorClass } from "@/lib/bookings/tutor-queries";
import { dayParts, isToday, longDate, timeAR, timeRange } from "@/lib/format";
import type { AccountNotice } from "@/lib/payments/account-notice";

export function TeacherDashboard({
  tutorId,
  status,
  reason,
  rating,
  upcoming,
  completed,
  nextOpenSlot,
  loadFailed,
  payoutAccount,
  accountNotice,
}: {
  tutorId: string;
  status: string;
  reason: string | null;
  rating: number;
  upcoming: TutorClass[];
  completed: TutorClass[];
  nextOpenSlot: string | null;
  loadFailed: boolean;
  /** Estado de la cuenta de cobro (Mercado Pago), calculado en el servidor. */
  payoutAccount: PayoutAccountView;
  /** Resultado de la vinculación recién hecha (`?cuenta=`), si vuelve de Mercado Pago. */
  accountNotice: AccountNotice | null;
}) {
  // Al volver de Mercado Pago se abre directo la pestaña donde está el resultado.
  const [tab, setTab] = useState(
    accountNotice ? "Cuenta de cobro" : "Próximas clases",
  );
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
      {tab !== "Cuenta de cobro" && (
        <PayoutAccountReminder
          status={payoutAccount.status}
          onOpen={() => setTab("Cuenta de cobro")}
        />
      )}
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
                  <TeacherClassCancel bookingId={next.id} startsAt={next.startsAt} endsAt={next.endsAt} />
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
                            <TeacherClassCancel bookingId={item.id} startsAt={item.startsAt} endsAt={item.endsAt} />
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
        <PayoutAccountPanel view={payoutAccount} notice={accountNotice} />
      )}
    </div>
  );
}
