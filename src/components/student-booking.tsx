"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Avatar,
  Badge,
  ButtonLink,
  Icon,
  PageHeading,
  SampleBanner,
} from "@/components/ui";
import type { BookingChoice } from "@/lib/bookings/params";
import { money } from "@/lib/format";
import type { Teacher } from "@/lib/tutors/view";

function dateLabel(date: string, short = false) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("es-AR", {
    weekday: short ? "short" : "long",
    day: "numeric",
    month: short ? "short" : "long",
  });
}

function ProgressSteps({ payment = false }: { payment?: boolean }) {
  return (
    <ol className="stu-steps" aria-label="Pasos de la reserva">
      <li
        className={payment ? "stu-step-done" : "stu-step-current"}
        aria-current={!payment ? "step" : undefined}
      >
        <span>{payment ? <Icon name="check" size={14} /> : "1"}</span> Elegí tu
        horario
      </li>
      <li
        className={payment ? "stu-step-current" : ""}
        aria-current={payment ? "step" : undefined}
      >
        <span>2</span> Confirmá tu clase
      </li>
      <li>
        <span>3</span> A aprender
      </li>
    </ol>
  );
}

function BookingSummary({
  teacher,
  date,
  time,
  subject,
}: {
  teacher: Teacher;
  date: string;
  time: string;
  subject: string;
}) {
  return (
    <aside className="stu-summary">
      <span className="stu-eyebrow">TU PRÓXIMO PASO</span>
      <div className="stu-teacher">
        <Avatar
          name={teacher.name}
          src={teacher.photo ?? undefined}
          size={64}
        />
        <div>
          <h3>{teacher.name}</h3>
          <span>Docente de {teacher.subject}</span>
        </div>
      </div>
      <h2>{subject || teacher.subject}</h2>
      <dl className="stu-summary-details">
        <div>
          <dt>
            <Icon name="calendar" size={17} /> Fecha
          </dt>
          <dd>{date ? dateLabel(date, true) : "Por elegir"}</dd>
        </div>
        <div>
          <dt>
            <Icon name="clock" size={17} /> Horario
          </dt>
          <dd>{time ? `${time} h` : "Por elegir"}</dd>
        </div>
        <div>
          <dt>
            <Icon name="video" size={17} /> Modalidad
          </dt>
          <dd>Online, individual</dd>
        </div>
      </dl>
      <div className="stu-summary-total">
        <span>Total por la clase</span>
        <strong>{money(teacher.price)}</strong>
        <small>Pesos argentinos</small>
      </div>
      <p className="stu-summary-note">
        <Icon name="shield" size={18} /> Una hora para preguntar, practicar y
        entender a tu ritmo.
      </p>
    </aside>
  );
}

const SAMPLE_NOTICE = (
  <SampleBanner>
    Reservar y pagar todavía no están conectados: no se crea ninguna reserva ni
    se realiza ningún cobro. Los horarios del calendario son de ejemplo.
  </SampleBanner>
);

export function Reservation({
  teacher,
  today,
  initial,
}: {
  teacher: Teacher;
  /** Fecha de hoy (`YYYY-MM-DD`, hora de Argentina): el calendario arranca ahí. */
  today: string;
  initial: Partial<BookingChoice>;
}) {
  const router = useRouter();
  // Si llega una fecha preseleccionada (desde el perfil), el calendario abre en su semana.
  const initialWeek = initial.date
    ? Math.min(
        7,
        Math.max(
          0,
          Math.floor(
            (new Date(`${initial.date}T12:00:00`).getTime() -
              new Date(`${today}T12:00:00`).getTime()) /
              (7 * 86400000),
          ),
        ),
      )
    : 0;
  const [week, setWeek] = useState(initialWeek);
  const [selectedDate, setSelectedDate] = useState(initial.date ?? today);
  const [selectedTime, setSelectedTime] = useState(initial.time ?? "");
  const [subject, setSubject] = useState(initial.subject || teacher.subject);
  const [notes, setNotes] = useState("");
  const dates = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(`${today}T12:00:00`);
    date.setDate(date.getDate() + week * 7 + index);
    return date;
  });
  const selectedDay = new Date(`${selectedDate}T12:00:00`).getDay();
  const slots =
    selectedDay === 0 || selectedDay === 6
      ? []
      : selectedDay % 2 === 0
        ? ["09:00", "10:00", "14:00", "16:00", "18:00"]
        : ["10:00", "11:00", "16:00", "17:00", "18:00"];

  function changeWeek(offset: number) {
    setWeek(offset);
    const date = new Date(`${today}T12:00:00`);
    date.setDate(date.getDate() + offset * 7);
    setSelectedDate(date.toISOString().slice(0, 10));
    setSelectedTime("");
  }
  function continueToPayment() {
    if (!selectedTime) return;
    const params = new URLSearchParams({
      fecha: selectedDate,
      hora: selectedTime,
      materia: subject,
    });
    router.push(`/alumno/reservar/${teacher.id}/pago?${params}`);
  }

  return (
    <div className="stu-page">
      <Link href={`/docentes/${teacher.id}`} className="stu-back">
        <Icon name="arrow-left" size={17} /> Volver al perfil de{" "}
        {teacher.name.split(" ")[0]}
      </Link>
      {SAMPLE_NOTICE}
      <ProgressSteps />
      <PageHeading
        eyebrow="UN ESPACIO PARA ENTENDER"
        title="Hacete tiempo para avanzar."
        description="Elegí el día y horario que mejor te quede."
      />
      <div className="stu-booking-layout">
        <section className="stu-booking-form">
          <label className="stu-field stu-subject-select">
            <span>¿Qué materia querés trabajar?</span>
            <select
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
            >
              {Array.from(new Set([...teacher.subjects, subject])).map(
                (item) => (
                  <option key={item}>{item}</option>
                ),
              )}
            </select>
          </label>
          <div className="stu-calendar-heading">
            <h2>Elegí un día</h2>
            <div>
              <button
                type="button"
                className="stu-icon-button"
                aria-label="Semana anterior"
                disabled={week === 0}
                onClick={() => changeWeek(week - 1)}
              >
                <Icon name="chevron-left" size={18} />
              </button>
              <span>
                {dates[0].toLocaleDateString("es-AR", {
                  month: "long",
                  year: "numeric",
                })}
              </span>
              <button
                type="button"
                className="stu-icon-button"
                aria-label="Semana siguiente"
                disabled={week >= 7}
                onClick={() => changeWeek(week + 1)}
              >
                <Icon name="chevron-right" size={18} />
              </button>
            </div>
          </div>
          <div className="stu-day-grid" aria-label="Fechas disponibles">
            {dates.map((date) => {
              const key = date.toISOString().slice(0, 10);
              return (
                <button
                  type="button"
                  key={key}
                  aria-pressed={selectedDate === key}
                  className={selectedDate === key ? "is-selected" : ""}
                  onClick={() => {
                    setSelectedDate(key);
                    setSelectedTime("");
                  }}
                >
                  <span>
                    {date
                      .toLocaleDateString("es-AR", { weekday: "short" })
                      .replace(".", "")}
                  </span>
                  <strong>{date.getDate()}</strong>
                  <i
                    className={
                      date.getDay() === 0 || date.getDay() === 6
                        ? "stu-dot-empty"
                        : ""
                    }
                  />
                </button>
              );
            })}
          </div>
          <div className="stu-times-heading">
            <h2>Horarios disponibles</h2>
            <span>
              <Icon name="clock" size={14} /> Hora de Argentina (GMT−3)
            </span>
          </div>
          <div className="stu-time-grid" aria-label="Horarios de clase">
            {slots.map((slot) => (
              <button
                type="button"
                key={slot}
                className={selectedTime === slot ? "is-selected" : ""}
                aria-pressed={selectedTime === slot}
                onClick={() => setSelectedTime(slot)}
              >
                {slot} h
                {selectedTime === slot && <Icon name="check" size={16} />}
              </button>
            ))}
          </div>
          {slots.length === 0 && (
            <div className="stu-no-slots">
              <Icon name="calendar" size={24} />
              <p>
                No hay horarios este día.
                <span>Probá con un día de la semana.</span>
              </p>
            </div>
          )}
          <label className="stu-field stu-notes-field">
            <span>
              Contale un poco sobre tus dudas <small>Opcional</small>
            </span>
            <textarea
              placeholder="Por ejemplo: quiero practicar integrales para el parcial del viernes."
              rows={3}
              maxLength={500}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
            <small>Tu docente puede preparar la clase con este contexto.</small>
          </label>
          <div className="stu-form-actions">
            <span>
              {selectedTime
                ? `${dateLabel(selectedDate, true)} · ${selectedTime} h`
                : "Seleccioná un horario para continuar"}
            </span>
            <button
              type="button"
              className="stu-button"
              disabled={!selectedTime}
              onClick={continueToPayment}
            >
              Continuar <Icon name="arrow-right" size={18} />
            </button>
          </div>
        </section>
        <BookingSummary
          teacher={teacher}
          date={selectedDate}
          time={selectedTime}
          subject={subject}
        />
      </div>
    </div>
  );
}

export function Checkout({
  teacher,
  details,
}: {
  teacher: Teacher;
  details: BookingChoice;
}) {
  const [accepted, setAccepted] = useState(false);
  const [outcome, setOutcome] = useState("approved");
  const [status, setStatus] = useState("ready");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  function simulate() {
    if (!accepted) return;
    setStatus("loading");
    timer.current = setTimeout(() => {
      setStatus(outcome === "approved" ? "approved" : outcome);
    }, 750);
  }
  const changeScheduleHref = `/alumno/reservar/${teacher.id}?${new URLSearchParams(
    { fecha: details.date, hora: details.time, materia: details.subject },
  )}`;

  if (status === "approved")
    return (
      <div className="stu-page stu-result-page">
        <div className="stu-result-mark">
          <Icon name="check" size={40} />
        </div>
        <Badge tone="green">Reserva de muestra</Badge>
        <h1>
          Así se vería tu clase
          <br />
          ya reservada.
        </h1>
        <p>Tu clase con {teacher.name} quedaría en tu agenda.</p>
        <div className="stu-confirmed-details">
          <strong>{details.subject}</strong>
          <span>
            {dateLabel(details.date)} · {details.time} h
          </span>
          <span>Online, individual</span>
        </div>
        <ButtonLink href="/alumno">
          Ir a mi espacio <Icon name="arrow-right" size={18} />
        </ButtonLink>
        <p className="stu-result-note">
          Es una vista de muestra: no se creó ninguna reserva, no se realizó
          ningún cobro y no se envió ningún correo.
        </p>
      </div>
    );

  return (
    <div className="stu-page">
      <Link href={changeScheduleHref} className="stu-back">
        <Icon name="arrow-left" size={17} /> Cambiar horario
      </Link>
      {SAMPLE_NOTICE}
      <ProgressSteps payment />
      <PageHeading
        eyebrow="TODO LISTO PARA TU CLASE"
        title="El siguiente paso es entender."
        description="Revisá los detalles de tu reserva y confirmá para seguir."
      />
      <div className="stu-booking-layout">
        <section className="stu-checkout-main">
          <div className="stu-demo-banner">
            <Icon name="shield" size={20} />
            <div>
              <strong>El pago es simulado</strong>
              <p>
                No ingreses datos de tarjetas: no se realizará ningún cobro.
              </p>
            </div>
          </div>
          {status === "pending" ? (
            <div className="stu-payment-status" role="status">
              <Icon name="clock" size={36} />
              <h2>El pago está pendiente.</h2>
              <p>
                En el producto final, tu reserva se confirmará cuando el
                proveedor acredite el pago.
              </p>
              <button
                type="button"
                className="stu-button"
                onClick={() => setStatus("approved")}
              >
                Simular acreditación <Icon name="check" size={18} />
              </button>
              <button
                type="button"
                className="stu-text-link"
                onClick={() => setStatus("ready")}
              >
                Volver a las opciones de pago
              </button>
            </div>
          ) : status === "failed" ? (
            <div className="stu-payment-status stu-payment-error" role="alert">
              <Icon name="x" size={36} />
              <h2>El pago no se pudo completar.</h2>
              <p>
                No se realizó ningún cobro. Tu horario sigue seleccionado para
                que puedas volver a intentarlo.
              </p>
              <button
                type="button"
                className="stu-button"
                onClick={() => {
                  setOutcome("approved");
                  setStatus("ready");
                }}
              >
                Volver a intentar <Icon name="arrow-right" size={18} />
              </button>
            </div>
          ) : (
            <>
              <h2>Forma de pago</h2>
              <div className="stu-payment-method">
                <span className="stu-radio-mark" />
                <div>
                  <strong>Mercado Pago</strong>
                  <span>Tarjeta de crédito, débito o dinero en cuenta</span>
                </div>
                <span className="stu-mp-wordmark">mp</span>
              </div>
              <label className="stu-field stu-simulation-field">
                <span>Resultado de la simulación</span>
                <select
                  value={outcome}
                  onChange={(event) => setOutcome(event.target.value)}
                  disabled={status === "loading"}
                >
                  <option value="approved">Pago aprobado</option>
                  <option value="pending">Pago pendiente</option>
                  <option value="failed">Pago rechazado</option>
                </select>
                <small>
                  Elegí un estado para explorar las distintas pantallas.
                </small>
              </label>
              <label className="stu-checkbox">
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={(event) => setAccepted(event.target.checked)}
                />
                <span>
                  Leí las{" "}
                  <Link href="/cancelacion">condiciones de la reserva</Link> y
                  entiendo que se trata de una vista de muestra.
                </span>
              </label>
              <button
                type="button"
                className="stu-button stu-wide-button"
                disabled={!accepted || status === "loading"}
                onClick={simulate}
              >
                {status === "loading"
                  ? "Procesando simulación…"
                  : "Simular pago"}
                <Icon
                  name={status === "loading" ? "clock" : "arrow-right"}
                  size={18}
                />
              </button>
              <p className="stu-payment-caption">
                Tu reserva se confirma después del estado de pago aprobado.
              </p>
            </>
          )}
          <div className="stu-checkout-help">
            <h3>Un encuentro, todo el foco.</h3>
            <p>
              Vas a tener una clase individual, en la sala de EstudiApp, para
              trabajar los temas que necesitás.
            </p>
          </div>
        </section>
        <BookingSummary teacher={teacher} {...details} />
      </div>
    </div>
  );
}
