"use client";

import { useState } from "react";
import { Notice } from "@/components/management-ui";
import { PageHeading, SampleBanner } from "@/components/ui";
import { VerificationStatusBanner } from "@/components/verification-status-banner";

const hours = [
  "09:00",
  "10:00",
  "11:00",
  "14:00",
  "15:00",
  "16:00",
  "17:00",
  "18:00",
];
const dayNames = ["LUN", "MAR", "MIÉ", "JUE", "VIE"];

// Reservas de ejemplo: la agenda todavía no está conectada a la base.
const reserved: Record<string, string> = {
  "0-2-7": "Estudiante",
  "0-3-1": "Estudiante",
  "0-4-5": "Estudiante",
};

/** Agenda semanal de muestra. Los cambios viven solo en esta pantalla. */
export function TeacherAvailability({
  weekStart,
  todayIndex,
  status,
}: {
  /** Lunes de la semana actual (`YYYY-MM-DD`). */
  weekStart: string;
  /** Posición de hoy dentro de lunes a viernes, o -1 si es fin de semana. */
  todayIndex: number;
  status: string;
}) {
  const [week, setWeek] = useState(0);
  const [slots, setSlots] = useState<Record<string, boolean>>({
    "0-0-1": true,
    "0-0-2": true,
    "0-1-4": true,
    "0-2-3": true,
    "0-2-4": true,
    "0-3-1": true,
    "0-3-4": true,
    "0-4-5": true,
    "0-4-6": true,
  });
  const [notice, setNotice] = useState("");
  const [changed, setChanged] = useState(false);
  const approved = status === "aprobado";

  const dates = dayNames.map((_, index) => {
    const date = new Date(`${weekStart}T12:00:00`);
    date.setDate(date.getDate() + week * 7 + index);
    return date;
  });
  const monthLabel = dates[0].toLocaleDateString("es-AR", {
    month: "long",
    year: "numeric",
  });
  const availableCount = Object.keys(slots).filter(
    (key) => key.startsWith(`${week}-`) && slots[key] && !reserved[key],
  ).length;

  return (
    <div className="mgmt-page">
      <PageHeading
        eyebrow="TU AGENDA"
        title="Hacé espacio para enseñar."
        description="Elegí los horarios en los que querés recibir estudiantes. Cada franja dura 60 minutos."
      >
        <button
          type="button"
          className="mgmt-button"
          disabled={!changed}
          onClick={() => {
            setNotice(
              "Es una vista de muestra: los horarios no se guardaron ni se publicaron.",
            );
            setChanged(false);
          }}
        >
          {changed ? "Guardar cambios" : "Agenda actualizada"}
          <span aria-hidden="true">{changed ? "↗" : "✓"}</span>
        </button>
      </PageHeading>
      <SampleBanner>
        La gestión de disponibilidad todavía no está conectada: lo que marques
        acá no se guarda ni se publica. Las reservas que ves son de ejemplo.
      </SampleBanner>
      {!approved && <VerificationStatusBanner status={status} />}
      <section className="mgmt-calendar">
        <div className="mgmt-calendar-toolbar">
          <div>
            <span className="mgmt-small-label">
              SEMANA DEL {dates[0].getDate()} AL {dates[4].getDate()}
            </span>
            <h2>{monthLabel}</h2>
          </div>
          <div className="mgmt-calendar-controls">
            <button
              type="button"
              aria-label="Semana anterior"
              disabled={week === 0}
              onClick={() => setWeek(week - 1)}
            >
              ←
            </button>
            <button type="button" onClick={() => setWeek(0)}>
              Esta semana
            </button>
            <button
              type="button"
              aria-label="Semana siguiente"
              onClick={() => setWeek(week + 1)}
            >
              →
            </button>
          </div>
        </div>
        <div className="mgmt-calendar-scroll">
          <div className="mgmt-week-grid">
            <div className="mgmt-calendar-corner">GMT−3</div>
            {dates.map((date, index) => {
              const isToday = week === 0 && index === todayIndex;
              return (
                <div
                  key={index}
                  className={`mgmt-day-heading ${isToday ? "is-today" : ""}`}
                >
                  <span>{dayNames[index]}</span>
                  <strong>{date.getDate()}</strong>
                  {isToday && <small>HOY</small>}
                </div>
              );
            })}
            {hours.map((hour, row) => (
              <div className="mgmt-calendar-grid-row" key={hour}>
                <div className="mgmt-time-label">{hour}</div>
                {dates.map((_, col) => {
                  const key = `${week}-${col}-${row}`;
                  const booking = reserved[key];
                  return (
                    <button
                      type="button"
                      key={key}
                      className={`mgmt-slot ${booking ? "is-reserved" : slots[key] ? "is-available" : ""}`}
                      disabled={!!booking}
                      aria-label={`${dayNames[col]} ${dates[col].getDate()}, ${hour}: ${booking ? "reservado" : slots[key] ? "disponible, tocar para bloquear" : "bloqueado, tocar para habilitar"}`}
                      aria-pressed={!booking && !!slots[key]}
                      onClick={() => {
                        setSlots((current) => ({
                          ...current,
                          [key]: !current[key],
                        }));
                        setChanged(true);
                        setNotice("");
                      }}
                    >
                      <span>
                        {booking || (slots[key] ? "Disponible" : "+")}
                      </span>
                      {booking && <small>Reservado</small>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <div className="mgmt-calendar-footer">
          <div className="mgmt-calendar-legend">
            <span>
              <i className="is-available" />
              Disponible
            </span>
            <span>
              <i className="is-reserved" />
              Reservado
            </span>
            <span>
              <i />
              Sin disponibilidad
            </span>
          </div>
          <strong>{availableCount} horas disponibles</strong>
        </div>
      </section>
      <div className="mgmt-under-calendar">
        <p>
          <strong>Un clic para abrir, otro para cerrar.</strong> Las clases ya
          reservadas permanecen protegidas.
        </p>
        <span>Horario de Argentina · GMT−3</span>
      </div>
      <Notice message={notice} />
    </div>
  );
}
