"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  cancelBooking,
  payWithCard,
  preparePayment,
  reconcileBooking,
  simulatePayment,
} from "@/app/alumno/reservas/[id]/actions";
import { BookingSummary, ProgressSteps } from "@/components/booking-summary";
import { CardPaymentForm } from "@/components/card-payment-form";
import { Badge, ButtonLink, Icon, PageHeading } from "@/components/ui";
import {
  PAYMENT_POLL_INTERVAL_MS,
  PAYMENT_POLL_MAX_MS,
  isConfirmingPayment,
  refundSummaryText,
  shouldReconcile,
  type PaymentReturn,
} from "@/lib/bookings/payment-ui";
import type { BookingDetail } from "@/lib/bookings/queries";
import { refundExplanation, refundPercent, type RefundPercent } from "@/lib/bookings/refund-policy";
import { longDate, timeRange } from "@/lib/format";

function mmss(milliseconds: number) {
  const total = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Cada cuánto se vuelve a consultar al servidor una vez que la cuenta llegó a cero. */
const RETRY_REFRESH_MS = 5000;

/** Lo que se le muestra a la persona ANTES de confirmar la cancelación de una reserva paga. */
type RefundPreview = { percent: RefundPercent; text: string };

/**
 * «Cancelar reserva» con confirmación en línea: cancelar libera el horario para
 * cualquier otra persona y no se puede deshacer, así que un toque accidental no
 * debe alcanzar. Si la reserva ya está paga, antes de confirmar se le dice cuánto
 * se le devuelve (`preview`, calculado en el momento de abrir la confirmación).
 */
function CancelControl({
  disabled,
  preview,
  onConfirm,
}: {
  disabled: boolean;
  /** Solo para reservas pagas: qué reembolso corresponde si cancela ahora. */
  preview?: () => RefundPreview;
  /** Recibe el porcentaje que se le mostró, para que el servidor avise si cambió mientras decidía. */
  onConfirm: (shownPercent?: number) => void;
}) {
  const [shown, setShown] = useState<RefundPreview | null>(null);
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <button
        type="button"
        className="stu-text-link"
        disabled={disabled}
        onClick={() => {
          setShown(preview ? preview() : null);
          setAsking(true);
        }}
      >
        Cancelar reserva
      </button>
    );
  return (
    <div className="stu-cancel-confirm" role="group" aria-label="Confirmar cancelación">
      <p>
        ¿Cancelar la reserva? El horario queda libre para otras personas.
        {shown && (
          <>
            {" "}
            <strong>{shown.text}</strong>{" "}
            <Link href="/cancelacion" className="stu-text-link">
              Ver la política de reembolsos
            </Link>
          </>
        )}
      </p>
      <button
        type="button"
        className="stu-button"
        disabled={disabled}
        onClick={() => {
          setAsking(false);
          onConfirm(shown?.percent);
        }}
      >
        Sí, cancelar
      </button>
      <button
        type="button"
        className="stu-text-link"
        disabled={disabled}
        onClick={() => setAsking(false)}
      >
        No, volver
      </button>
    </div>
  );
}

/**
 * Mientras el pago se confirma: «Estamos confirmando tu pago». Se avisa con `role="status"` (anuncio amable, no
 * interrumpe). Pasados 90 segundos deja de insistir y le habla con calma a la persona.
 */
function PaymentConfirmingNotice({ gaveUp }: { gaveUp: boolean }) {
  return (
    <div className="stu-pay-status" role="status" aria-live="polite">
      <span className="stu-pay-status-mark" aria-hidden="true">
        <Icon name="clock" size={20} />
      </span>
      <div>
        {gaveUp ? (
          <>
            <strong>Todavía no vemos tu pago acreditado</strong>
            <p>
              Si ya pagaste, tu reserva se confirma en unos minutos y te avisamos por email. No hace falta que
              vuelvas a pagar.
            </p>
          </>
        ) : (
          <>
            <strong>Estamos confirmando tu pago</strong>
            <p>Esto suele tardar unos segundos. Dejá esta página abierta.</p>
          </>
        )}
      </div>
    </div>
  );
}

/** Una reserva del alumno: pago pendiente, confirmada, cancelada o completada. */
export function BookingDetailView({
  booking,
  expiresAt,
  now,
  simulationEnabled,
  paymentsEnabled = false,
  paymentReturn = null,
}: {
  booking: BookingDetail;
  /** Cuándo vence la reserva si sigue sin pagarse (ISO). */
  expiresAt: string;
  /** Instante del servidor (ms): evita diferencias de reloj al hidratar. */
  now: number;
  simulationEnabled: boolean;
  /** El cobro con Mercado Pago está configurado en el servidor. */
  paymentsEnabled?: boolean;
  /** Cómo volvió el alumno del checkout (`?pago=`). Solo decide qué mensaje se muestra: nunca confirma nada. */
  paymentReturn?: PaymentReturn | null;
}) {
  const router = useRouter();
  const [remaining, setRemaining] = useState(
    Math.max(0, new Date(expiresAt).getTime() - now),
  );
  const [error, setError] = useState("");
  const [working, startWorking] = useTransition();
  const [cardForm, setCardForm] = useState<{ publicKey: string; amount: number; payerEmail: string | null } | null>(null);
  const [gaveUp, setGaveUp] = useState(false);
  const pending = booking.status === "pendiente_pago";
  const confirming = isConfirmingPayment(paymentReturn, booking.status);

  // Reloj del servidor: la hora de la persona puede estar adelantada o atrasada. Se usa para decir, al abrir la
  // confirmación de cancelar, qué reembolso corresponde en ESE momento.
  const clock = useRef<{ serverNow: number; at: number } | null>(null);
  useEffect(() => {
    clock.current = { serverNow: now, at: performance.now() };
  }, [now]);
  function estimatedServerNow() {
    const base = clock.current;
    return base ? base.serverNow + (performance.now() - base.at) : now;
  }

  // La cuenta parte de la hora del servidor (`now`) y avanza con un reloj
  // monotónico, no con la hora del navegador: si el reloj de la persona está
  // adelantado o atrasado, el tiempo que ve no cambia. Cada vez que el servidor
  // vuelve a renderizar la página llega un `now` nuevo y la cuenta se reajusta.
  useEffect(() => {
    if (!pending) return;
    const initial = new Date(expiresAt).getTime() - now;
    const startedAt = performance.now();
    let lastRefresh = Number.NEGATIVE_INFINITY;
    const timer = setInterval(() => {
      const elapsed = performance.now() - startedAt;
      setRemaining(Math.max(0, initial - elapsed));
      if (initial - elapsed <= 0 && elapsed - lastRefresh >= RETRY_REFRESH_MS) {
        lastRefresh = elapsed;
        // El servidor libera la reserva vencida al volver a cargar. Si todavía
        // no venció del lado de la base, se reintenta en unos segundos.
        router.refresh();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [pending, expiresAt, now, router]);

  // Volvió de Mercado Pago y la reserva sigue pendiente: se vuelve a leer la reserva cada 3 segundos hasta 90. De
  // cada tres lecturas, una también le pregunta a Mercado Pago por el pago, así un aviso perdido o tardío no deja
  // al alumno esperando. El estado REAL sale siempre de la base: esto solo hace que se entere antes.
  useEffect(() => {
    if (!confirming) return;
    const startedAt = performance.now();
    let tick = 0;
    let stopped = false;

    async function check() {
      if (stopped) return;
      if (shouldReconcile(tick++)) {
        try {
          await reconcileBooking(booking.id);
        } catch {
          // Una consulta que falla no rompe la pantalla: el aviso normal sigue en pie.
        }
      }
      if (!stopped) router.refresh();
    }

    void check();
    const timer = setInterval(() => {
      if (performance.now() - startedAt >= PAYMENT_POLL_MAX_MS) {
        clearInterval(timer);
        setGaveUp(true);
        return;
      }
      void check();
    }, PAYMENT_POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [confirming, booking.id, router]);

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError("");
    startWorking(async () => {
      const result = await action();
      if (!result.ok) setError(result.error ?? "No pudimos completar la operación.");
    });
  }

  // Paso 1: el servidor comprueba la reserva y devuelve con qué mostrar el formulario de tarjeta.
  function openCardForm() {
    setError("");
    startWorking(async () => {
      try {
        const result = await preparePayment(booking.id);
        if (result.ok) setCardForm({ publicKey: result.publicKey, amount: result.amount, payerEmail: result.payerEmail });
        else setError(result.error);
      } catch {
        setError("No pudimos iniciar el pago. Intentá de nuevo en unos minutos.");
      }
    });
  }

  // Paso 2: el formulario de Mercado Pago ya tokenizó la tarjeta; el servidor cobra y la base decide.
  async function submitCard(formData: unknown) {
    setError("");
    try {
      const result = await payWithCard(booking.id, formData);
      if (!result.ok) {
        setError(result.error);
        return false;
      }
      // Confirmada, todavía procesándose o devuelta por llegar tarde: la pantalla de la reserva (con `?pago=ok`)
      // muestra el estado real que sale de la base y, si sigue pendiente, consulta hasta que se confirme.
      setCardForm(null);
      router.replace(`/alumno/reservas/${booking.id}?pago=ok`);
      return true;
    } catch {
      setError("No pudimos procesar el pago. Revisá en unos minutos si se confirmó antes de volver a intentar.");
      return false;
    }
  }

  const busy = working;

  // Qué reembolso corresponde si cancela AHORA (solo para reservas pagas).
  const refundPreview = (): RefundPreview => {
    const percent = refundPercent({ startsAt: booking.startsAt, at: new Date(estimatedServerNow()) });
    return { percent, text: refundExplanation(percent, booking.price) };
  };

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
          <strong>Clase individual con {booking.tutorName}</strong>
          <span>
            {longDate(booking.startsAt)} · {timeRange(booking.startsAt, booking.endsAt)}
          </span>
          <span>Online, individual</span>
        </div>
        <ButtonLink href="/alumno">
          Ir a mi espacio <Icon name="arrow-right" size={18} />
        </ButtonLink>
        <CancelControl
          disabled={busy}
          preview={booking.paid ? refundPreview : undefined}
          onConfirm={(shownPercent) => run(() => cancelBooking(booking.id, shownPercent))}
        />
        {error && (
          <p className="stu-field-error" role="alert">
            {error}
          </p>
        )}
      </div>
    );

  if (booking.status === "cancelada") {
    const refundNote = refundSummaryText(booking.refund, booking.everPaid);
    return (
      <div className="stu-page stu-result-page">
        <div className="stu-result-mark">
          <Icon name="x" size={40} />
        </div>
        <Badge tone="muted">Reserva cancelada</Badge>
        <h1>Esta reserva ya no está activa.</h1>
        <p>{booking.cancellationReason ?? "La reserva fue cancelada."}</p>
        {refundNote && (
          <p className="stu-refund-note" role="status">
            {refundNote}
          </p>
        )}
        {!booking.everPaid && (paymentReturn === "ok" || paymentReturn === "pendiente") && (
          <p className="stu-refund-note" role="status">
            Si llegaste a pagar, te devolvemos el 100 % automáticamente y te avisamos por email.
          </p>
        )}
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
  }

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
          {confirming && <PaymentConfirmingNotice gaveUp={gaveUp} />}
          {paymentReturn === "fallido" && (
            <div className="stu-pay-status stu-pay-status-failed" role="status" aria-live="polite">
              <span className="stu-pay-status-mark" aria-hidden="true">
                <Icon name="info" size={20} />
              </span>
              <div>
                <strong>No se completó el pago</strong>
                <p>Podés intentarlo de nuevo mientras dure tu reserva.</p>
              </div>
            </div>
          )}
          {/* Mientras se confirma un pago no se ofrece pagar otra vez: sería cobrar dos veces. */}
          {(!confirming || gaveUp) && (
            <>
              <h2>Forma de pago</h2>
              <div className="stu-payment-method">
                <span className="stu-radio-mark" />
                <div>
                  <strong>Tarjeta de crédito o débito</strong>
                  <span>Procesado por Mercado Pago</span>
                </div>
                <span className="stu-mp-wordmark">mp</span>
              </div>
              {paymentsEnabled ? (
                cardForm ? (
                  <>
                    <CardPaymentForm
                      publicKey={cardForm.publicKey}
                      amount={cardForm.amount}
                      payerEmail={cardForm.payerEmail}
                      onSubmit={submitCard}
                    />
                    <p className="stu-payment-caption">
                      Los datos de tu tarjeta los procesa Mercado Pago: EstudiApp no los ve ni los guarda. Si
                      cancelás con tiempo, te devolvemos la plata:{" "}
                      <Link href="/cancelacion" className="stu-text-link">
                        mirá cómo funciona
                      </Link>
                      .
                    </p>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="stu-button stu-wide-button"
                      disabled={busy}
                      aria-busy={busy}
                      onClick={openCardForm}
                    >
                      {busy ? "Preparando el pago…" : "Pagar con tarjeta"} <Icon name="arrow-right" size={18} />
                    </button>
                    <p className="stu-payment-caption">
                      Pagás acá mismo, con el formulario seguro de Mercado Pago. Si cancelás con tiempo, te
                      devolvemos la plata:{" "}
                      <Link href="/cancelacion" className="stu-text-link">
                        mirá cómo funciona
                      </Link>
                      .
                    </p>
                  </>
                )
              ) : (
                <>
                  <button type="button" className="stu-button stu-wide-button" disabled>
                    Pagar con tarjeta <Icon name="arrow-right" size={18} />
                  </button>
                  <p className="stu-payment-caption">
                    El pago con tarjeta todavía no está disponible.
                  </p>
                </>
              )}
            </>
          )}
          {simulationEnabled && (
            <div className="stu-demo-banner">
              <Icon name="shield" size={20} />
              <div>
                <strong>Pago simulado (solo para desarrollo)</strong>
                <p>Confirma la reserva sin cobrar nada.</p>
                <button
                  type="button"
                  className="stu-button"
                  disabled={busy}
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
          <CancelControl
            disabled={busy}
            onConfirm={() => run(() => cancelBooking(booking.id))}
          />
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
