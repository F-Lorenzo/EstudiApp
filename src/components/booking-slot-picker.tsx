"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { reserveSlot } from "@/app/alumno/reservar/[id]/actions";
import { BookingSummary, ProgressSteps } from "@/components/booking-summary";
import { Icon, PageHeading } from "@/components/ui";
import { dateKeyAR, dayParts, longDate, timeAR } from "@/lib/format";
import type { BookableSlot } from "@/lib/bookings/queries";
import { HOLD_MINUTES } from "@/lib/bookings/hold";
import type { Teacher } from "@/lib/tutors/view";

/** Elegir uno de los horarios libres reales de un docente y reservarlo. */
export function BookingSlotPicker({
  teacher,
  slots,
  initialSlotId,
}: {
  teacher: Teacher;
  slots: BookableSlot[];
  initialSlotId?: string;
}) {
  // Horarios agrupados por día (en hora de Argentina).
  const days = useMemo(() => {
    const byDay = new Map<string, BookableSlot[]>();
    for (const slot of slots) {
      const key = dateKeyAR(slot.startsAt);
      byDay.set(key, [...(byDay.get(key) ?? []), slot]);
    }
    return [...byDay.entries()].map(([date, items]) => ({ date, items }));
  }, [slots]);

  const preselected = slots.find((slot) => slot.id === initialSlotId);
  const [selectedId, setSelectedId] = useState(preselected?.id ?? "");
  const [selectedDay, setSelectedDay] = useState(
    preselected ? dateKeyAR(preselected.startsAt) : (days[0]?.date ?? ""),
  );
  const [error, setError] = useState("");
  const [reserving, startReserving] = useTransition();

  const chosen = slots.find((slot) => slot.id === selectedId);
  const dayItems = days.find((day) => day.date === selectedDay)?.items ?? [];

  function reserve() {
    if (!chosen) return;
    setError("");
    startReserving(async () => {
      // Si sale bien, la acción redirige a la reserva y no vuelve acá.
      const result = await reserveSlot(chosen.id);
      if (result && !result.ok) setError(result.error);
    });
  }

  return (
    <div className="stu-page">
      <Link href={`/docentes/${teacher.id}`} className="stu-back">
        <Icon name="arrow-left" size={17} /> Volver al perfil de{" "}
        {teacher.name.split(" ")[0]}
      </Link>
      <ProgressSteps step="schedule" />
      <PageHeading
        eyebrow="UN ESPACIO PARA ENTENDER"
        title="Hacete tiempo para avanzar."
        description="Elegí el día y horario que mejor te quede. La clase dura 60 minutos."
      />
      <div className="stu-booking-layout">
        <section className="stu-booking-form">
          {days.length === 0 ? (
            <div className="stu-no-slots">
              <Icon name="calendar" size={24} />
              <p>
                {teacher.name.split(" ")[0]} todavía no tiene horarios libres.
                <span>Volvé a mirar pronto o elegí otro docente.</span>
              </p>
            </div>
          ) : (
            <>
              <div className="stu-calendar-heading">
                <h2>Elegí un día</h2>
              </div>
              <div className="stu-day-grid" aria-label="Días con horarios libres">
                {days.map(({ date, items }) => {
                  const parts = dayParts(items[0].startsAt);
                  return (
                    <button
                      type="button"
                      key={date}
                      aria-pressed={selectedDay === date}
                      className={selectedDay === date ? "is-selected" : ""}
                      onClick={() => {
                        setSelectedDay(date);
                        setError("");
                      }}
                    >
                      <span>{parts.weekday.slice(0, 3)}</span>
                      <strong>{parts.day}</strong>
                      <small>{parts.month}</small>
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
                {dayItems.map((slot) => (
                  <button
                    type="button"
                    key={slot.id}
                    className={selectedId === slot.id ? "is-selected" : ""}
                    aria-pressed={selectedId === slot.id}
                    onClick={() => {
                      setSelectedId(slot.id);
                      setError("");
                    }}
                  >
                    {timeAR(slot.startsAt)} h
                    {selectedId === slot.id && <Icon name="check" size={16} />}
                  </button>
                ))}
              </div>
            </>
          )}
          {error && (
            <p className="stu-field-error" role="alert">
              {error}
            </p>
          )}
          <div className="stu-form-actions">
            <span>
              {chosen
                ? `${longDate(chosen.startsAt)} · ${timeAR(chosen.startsAt)} h`
                : "Seleccioná un horario para continuar"}
            </span>
            <button
              type="button"
              className="stu-button"
              disabled={!chosen || reserving}
              onClick={reserve}
            >
              {reserving ? "Reservando…" : "Reservar y continuar"}{" "}
              <Icon name="arrow-right" size={18} />
            </button>
          </div>
          <p className="stu-payment-caption">
            Al reservar, el horario queda retenido {HOLD_MINUTES} minutos para
            que completes el pago.
          </p>
        </section>
        <BookingSummary
          tutorName={teacher.name}
          tutorPhoto={teacher.photo}
          subject={teacher.subject}
          startsAt={chosen?.startsAt}
          endsAt={chosen?.endsAt}
          price={teacher.price}
        />
      </div>
    </div>
  );
}
