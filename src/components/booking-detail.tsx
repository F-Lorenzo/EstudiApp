"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  cancelBooking,
  simulatePayment,
} from "@/app/alumno/reservas/[id]/actions";
import { BookingSummary, ProgressSteps } from "@/components/booking-summary";
import { Badge, ButtonLink, Icon, PageHeading } from "@/components/ui";
import type { BookingDetail } from "@/lib/bookings/queries";
import { longDate, timeRange } from "@/lib/format";

function mmss(milliseconds: number) {
  const total = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Una reserva del alumno: pago pendiente, confirmada, cancelada o completada. */
export function BookingDetailView({
  booking,
  expiresAt,
  now,
  simulationEnabled,
}: {
  booking: BookingDetail;
  /** Cuándo vence la reserva si sigue sin pagarse (ISO). */
  expiresAt: string;
  /** Instante del servidor (ms): evita diferencias de reloj al hidratar. */
  now: number;
  simulationEnabled: boolean;
}) {
  const router = useRouter();
  const [remaining, setRemaining] = useState(
    Math.max(0, new Date(expiresAt).getTime() - now),
  );
  const [error, setError] = useState("");
  const [working, startWorking] = useTransition();
  const pending = booking.status === "pendiente_pago";

  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => {
      const left = new Date(expiresAt).getTime() - Date.now();
      setRemaining(Math.max(0, left));
      if (left <= 0) {
        clearInterval(timer);
        // El servidor libera la reserva vencida al volver a cargar.
        router.refresh();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [pending, expiresAt, router]);

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError("");
    startWorking(async () => {
      const result = await action();
      if (!result.ok) setError(result.error ?? "No pudimos completar la operación.");
    });
  }

  const summary = (
    <BookingSummary
      tutorName={booking.tutorName}
      tutorPhoto={booking.tutorPhoto}
      subject={booking.subject}
      startsAt={booking.startsAt}
      endsAt={booking.endsAt}
      price={booking.price}
    />
  );

  if (booking.status === "confirmada")
    return (
      <div className="stu-page stu-result-page">
        <div className="stu-result-mark">
          <Icon name="check" size={40} />
        </div>
        <Badge tone="green">Reserva confirmada</Badge>
        <h1>
          Un lugar para tus dudas.
          <br />
          Ya está reservado.
        </h1>
        <p>Tu clase con {booking.tutorName} está en tu agenda.</p>
        <div className="stu-confirmed-details">
          <strong>Clase individual{booking.subject ? ` · ${booking.subject}` : ""}</strong>
          <span>
            {longDate(booking.startsAt)} · {timeRange(booking.startsAt, booking.endsAt)}
          </span>
          <span>Online, individual</span>
        </div>
        <ButtonLink href="/alumno">
          Ir a mi espacio <Icon name="arrow-right" size={18} />
        </ButtonLink>
        {booking.paid ? (
          <p className="stu-result-note">
            Para cancelar o reprogramar una clase ya paga, escribinos: la
            cancelación con reembolso todavía no está disponible.
          </p>
        ) : (
          <button
            type="button"
            className="stu-text-link"
            disabled={working}
            onClick={() => run(() => cancelBooking(booking.id))}
          >
            Cancelar reserva
          </button>
        )}
        {error && (
          <p className="stu-field-error" role="alert">
            {error}
          </p>
        )}
      </div>
    );

  if (booking.status === "cancelada")
    return (
      <div className="stu-page stu-result-page">
        <div className="stu-result-mark">
          <Icon name="x" size={40} />
        </div>
        <Badge tone="muted">Reserva cancelada</Badge>
        <h1>Esta reserva ya no está activa.</h1>
        <p>{booking.cancellationReason ?? "La reserva fue cancelada."}</p>
        <div className="stu-confirmed-details">
          <strong>Clase individual con {booking.tutorName}</strong>
          <span>
            {longDate(booking.startsAt)} · {timeRange(booking.startsAt, booking.endsAt)}
          </span>
        </div>
        <ButtonLink href={`/alumno/reservar/${booking.tutorId}`}>
          Elegir otro horario <Icon name="arrow-right" size={18} />
        </ButtonLink>
        <Link href="/alumno" className="stu-text-link">
          Volver a mi espacio
        </Link>
      </div>
    );

  if (booking.status === "completada")
    return (
      <div className="stu-page stu-result-page">
        <div className="stu-result-mark">
          <Icon name="check" size={40} />
        </div>
        <Badge tone="muted">Clase completada</Badge>
        <h1>Una duda menos. Un paso más.</h1>
        <p>
          Tu clase con {booking.tutorName} fue el{" "}
          {longDate(booking.startsAt)}.
        </p>
        <ButtonLink href={`/alumno/reservar/${booking.tutorId}`}>
          Reservar otra clase <Icon name="arrow-right" size={18} />
        </ButtonLink>
        <Link href="/alumno" className="stu-text-link">
          Volver a mi espacio
        </Link>
      </div>
    );

  // pendiente_pago
  return (
    <div className="stu-page">
      <Link href="/alumno" className="stu-back">
        <Icon name="arrow-left" size={17} /> Volver a mi espacio
      </Link>
      <ProgressSteps step="payment" />
      <PageHeading
        eyebrow="TODO LISTO PARA TU CLASE"
        title="El siguiente paso es entender."
        description="Completá el pago para confirmar tu clase."
      />
      <div className="stu-booking-layout">
        <section className="stu-checkout-main">
          <div className="stu-hold" role="timer" aria-live="off">
            <Icon name="clock" size={20} />
            <div>
              <strong>Tu horario está reservado por {mmss(remaining)}</strong>
              <p>Si no completás el pago a tiempo, el horario vuelve a quedar libre.</p>
            </div>
          </div>
          <h2>Forma de pago</h2>
          <div className="stu-payment-method">
            <span className="stu-radio-mark" />
            <div>
              <strong>Mercado Pago</strong>
              <span>Tarjeta de crédito, débito o dinero en cuenta</span>
            </div>
            <span className="stu-mp-wordmark">mp</span>
          </div>
          <button type="button" className="stu-button stu-wide-button" disabled>
            Pagar con Mercado Pago <Icon name="arrow-right" size={18} />
          </button>
          <p className="stu-payment-caption">
            El pago con Mercado Pago todavía no está disponible.
          </p>
          {simulationEnabled && (
            <div className="stu-demo-banner">
              <Icon name="shield" size={20} />
              <div>
                <strong>Pago simulado (solo para desarrollo)</strong>
                <p>Confirma la reserva sin cobrar nada.</p>
                <button
                  type="button"
                  className="stu-button"
                  disabled={working}
                  onClick={() => run(() => simulatePayment(booking.id))}
                >
                  {working ? "Procesando…" : "Simular pago aprobado"}{" "}
                  <Icon name="check" size={18} />
                </button>
              </div>
            </div>
          )}
          {error && (
            <p className="stu-field-error" role="alert">
              {error}
            </p>
          )}
          <button
            type="button"
            className="stu-text-link"
            disabled={working}
            onClick={() => run(() => cancelBooking(booking.id))}
          >
            Cancelar reserva
          </button>
          <div className="stu-checkout-help">
            <h3>Un encuentro, todo el foco.</h3>
            <p>
              Vas a tener una clase individual, en la sala de EstudiApp, para
              trabajar los temas que necesitás.
            </p>
          </div>
        </section>
        {summary}
      </div>
    </div>
  );
}
