"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { saveAvailability } from "@/app/docente/disponibilidad/actions";
import { Notice } from "@/components/management-ui";
import { PageHeading } from "@/components/ui";
import { VerificationStatusBanner } from "@/components/verification-status-banner";
import {
  DAY_NAMES,
  MAX_WEEKS_AHEAD,
  slotKey,
  slotStart,
  SLOT_HOURS,
  weekDates,
} from "@/lib/availability/slots";

type SlotState = "free" | "booked";

/**
 * Agenda semanal del docente. Los clics se acumulan como cambios pendientes
 * (incluso entre semanas) y se guardan juntos con «Guardar cambios».
 */
export function TeacherAvailability({
  week,
  weekStart,
  today,
  now,
  status,
  slots,
  loadFailed,
}: {
  /** Semanas respecto de la actual (0 = esta semana). */
  week: number;
  /** Lunes de la semana que se muestra (`YYYY-MM-DD`). */
  weekStart: string;
  today: string;
  /** Instante actual según el servidor (ms): evita diferencias de reloj al hidratar. */
  now: number;
  status: string;
  /** Estado guardado de cada franja de la semana, por clave `YYYY-MM-DDTHH`. */
  slots: Record<string, SlotState>;
  loadFailed: boolean;
}) {
  // Cambios sin guardar: true = quedar abierta, false = quedar cerrada. Solo
  // se registran los que difieren de lo guardado cuando se hizo el clic.
  const [pendingChanges, setPendingChanges] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [saving, startSaving] = useTransition();

  const dates = weekDates(weekStart);
  const monthLabel = new Date(`${weekStart}T12:00:00Z`).toLocaleDateString("es-AR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const dayOf = (date: string) => Number(date.slice(8));
  const changeCount = Object.keys(pendingChanges).length;

  const isOpen = (key: string) => pendingChanges[key] ?? slots[key] === "free";
  const availableCount = dates.reduce(
    (total, date) =>
      total +
      SLOT_HOURS.filter((hour) => {
        const key = slotKey(date, hour);
        return slots[key] !== "booked" && isOpen(key);
      }).length,
    0,
  );

  function toggle(key: string) {
    const wantOpen = !isOpen(key);
    const saved = slots[key] === "free";
    setPendingChanges((current) => {
      const next = { ...current };
      if (wantOpen === saved) delete next[key];
      else next[key] = wantOpen;
      return next;
    });
    setNotice("");
    setError("");
  }

  function save() {
    const open = Object.keys(pendingChanges).filter((key) => pendingChanges[key]);
    const close = Object.keys(pendingChanges).filter((key) => !pendingChanges[key]);
    setNotice("");
    setError("");
    startSaving(async () => {
      const result = await saveAvailability({ open, close });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPendingChanges({});
      const parts = [
        result.opened && `${result.opened} ${result.opened === 1 ? "horario abierto" : "horarios abiertos"}`,
        result.closed && `${result.closed} ${result.closed === 1 ? "horario cerrado" : "horarios cerrados"}`,
      ].filter(Boolean);
      setNotice(
        `${parts.length ? `Listo: ${parts.join(" y ")}.` : "No había cambios para guardar."}${
          result.protectedCount
            ? ` ${result.protectedCount} ${result.protectedCount === 1 ? "horario ya está reservado y quedó como estaba" : "horarios ya están reservados y quedaron como estaban"}.`
            : ""
        }`,
      );
    });
  }

  const href = (target: number) =>
    target === 0 ? "/docente/disponibilidad" : `/docente/disponibilidad?semana=${target}`;
  const weekEnd = dates[6];

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
          disabled={!changeCount || saving}
          onClick={save}
        >
          {saving
            ? "Guardando…"
            : changeCount
              ? `Guardar cambios (${changeCount})`
              : "Agenda actualizada"}
          <span aria-hidden="true">{changeCount && !saving ? "↗" : "✓"}</span>
        </button>
      </PageHeading>
      {status !== "aprobado" && (
        <VerificationStatusBanner status={status} />
      )}
      {loadFailed && (
        <p className="mgmt-field-error" role="alert">
          No pudimos cargar los horarios guardados de esta semana. Actualizá la
          página en un momento.
        </p>
      )}
      <section className="mgmt-calendar">
        <div className="mgmt-calendar-toolbar">
          <div>
            <span className="mgmt-small-label">
              SEMANA DEL {dayOf(weekStart)} AL {dayOf(weekEnd)}
            </span>
            <h2>{monthLabel}</h2>
          </div>
          <div className="mgmt-calendar-controls">
            {week > 0 ? (
              <Link aria-label="Semana anterior" href={href(week - 1)} scroll={false}>
                ←
              </Link>
            ) : (
              <span aria-hidden="true" className="is-disabled">
                ←
              </span>
            )}
            <Link href={href(0)} scroll={false}>
              Esta semana
            </Link>
            {week < MAX_WEEKS_AHEAD ? (
              <Link aria-label="Semana siguiente" href={href(week + 1)} scroll={false}>
                →
              </Link>
            ) : (
              <span aria-hidden="true" className="is-disabled">
                →
              </span>
            )}
          </div>
        </div>
        <div className="mgmt-calendar-scroll">
          <div className="mgmt-week-grid is-seven">
            <div className="mgmt-calendar-corner">GMT−3</div>
            {dates.map((date, index) => {
              const isToday = date === today;
              return (
                <div
                  key={date}
                  className={`mgmt-day-heading ${isToday ? "is-today" : ""}`}
                >
                  <span>{DAY_NAMES[index]}</span>
                  <strong>{dayOf(date)}</strong>
                  {isToday && <small>HOY</small>}
                </div>
              );
            })}
            {SLOT_HOURS.map((hour) => (
              <div className="mgmt-calendar-grid-row" key={hour}>
                <div className="mgmt-time-label">
                  {String(hour).padStart(2, "0")}:00
                </div>
                {dates.map((date, col) => {
                  const key = slotKey(date, hour);
                  const booked = slots[key] === "booked";
                  const past = slotStart(key)!.getTime() <= now;
                  const open = isOpen(key);
                  const changed = key in pendingChanges;
                  const label = `${DAY_NAMES[col]} ${dayOf(date)}, ${String(hour).padStart(2, "0")}:00: ${
                    booked
                      ? "reservado"
                      : past
                        ? "ya pasó"
                        : open
                          ? "disponible, tocar para cerrar"
                          : "cerrado, tocar para abrir"
                  }${changed ? " (cambio sin guardar)" : ""}`;
                  return (
                    <button
                      type="button"
                      key={key}
                      className={`mgmt-slot ${booked ? "is-reserved" : open ? "is-available" : ""} ${past && !booked ? "is-past" : ""} ${changed ? "is-changed" : ""}`}
                      disabled={booked || past}
                      aria-label={label}
                      aria-pressed={!booked && open}
                      onClick={() => toggle(key)}
                    >
                      <span>{booked ? "Reservado" : open ? "Disponible" : past ? "" : "+"}</span>
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
          <strong>
            {availableCount} {availableCount === 1 ? "hora disponible" : "horas disponibles"}
          </strong>
        </div>
      </section>
      <div className="mgmt-under-calendar">
        <p>
          <strong>Un clic para abrir, otro para cerrar.</strong> Los cambios se
          aplican al guardar. Las clases ya reservadas permanecen protegidas.
        </p>
        <span>Horario de Argentina · GMT−3</span>
      </div>
      {status !== "aprobado" && (
        <p className="mgmt-field-hint">
          Tus horarios se guardan, pero los estudiantes solo los ven cuando tu
          perfil esté aprobado.
        </p>
      )}
      {error && (
        <p className="mgmt-field-error" role="alert">
          {error}
        </p>
      )}
      <Notice message={notice} />
    </div>
  );
}
