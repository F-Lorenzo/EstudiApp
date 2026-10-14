"use client";

import { useId, useState, useTransition } from "react";
import { cancelTutorClass, type TutorCancelResult } from "@/app/docente/clases/actions";
import { formatPesos } from "@/lib/bookings/payment-ui";
import { longDate, timeRange } from "@/lib/format";
import "./teacher-class-cancel.css";

/** Máximo de caracteres del motivo (el mismo tope que valida la acción). */
const MAX_REASON_CHARS = 300;

export type TeacherClassCancelProps = {
  /** Id de la reserva (UUID) de la clase que se cancela. */
  bookingId: string;
  /** Comienzo y fin de la clase (ISO), para nombrarla en la confirmación. */
  startsAt: string;
  endsAt: string;
  /** Precio de la clase en pesos, para decir cuánto se le devuelve al alumno. Si falta, se dice «el total». */
  price?: number | null;
  /**
   * La clase está paga. Las clases confirmadas siempre lo están, así que por defecto es `true`. Con `false`
   * (una clase sin pago aprobado) la confirmación no habla de reembolso.
   */
  paid?: boolean;
  /** Se llama después de cancelar bien. La acción ya vuelve a leer el panel del docente. */
  onCancelled?: (result: Extract<TutorCancelResult, { ok: true }>) => void;
};

/**
 * «Cancelar esta clase» para el DOCENTE. Antes de confirmar le dice, sin letra chica, que el alumno recibe el
 * reembolso TOTAL aunque falte poco (la base lo decide así cuando cancela el docente), que el horario queda libre y
 * que no cobra esa clase. Después cuenta cómo quedó el reembolso.
 *
 * Lo monta quien arma el panel del docente, una vez por clase confirmada:
 *
 *   <TeacherClassCancel bookingId={clase.id} startsAt={clase.startsAt} endsAt={clase.endsAt} />
 *
 * (`TutorClass` todavía no trae el precio; si se agrega a la consulta, pasalo en `price`.)
 */
export function TeacherClassCancel({ bookingId, startsAt, endsAt, price = null, paid = true, onCancelled }: TeacherClassCancelProps) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [working, startWorking] = useTransition();
  const reasonId = useId();

  const classLabel = `${longDate(startsAt)} · ${timeRange(startsAt, endsAt)}`;

  function confirm() {
    setError("");
    startWorking(async () => {
      let result: TutorCancelResult;
      try {
        result = await cancelTutorClass(bookingId, reason.trim() || undefined);
      } catch {
        setError("No pudimos cancelar la clase. Intentá de nuevo en unos minutos.");
        return;
      }
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setAsking(false);
      setDone(doneMessage(result.refund));
      onCancelled?.(result);
    });
  }

  if (done) {
    return (
      <div className="tcc">
        <p className="tcc-done" role="status">
          {done}
        </p>
      </div>
    );
  }

  return (
    <div className="tcc">
      {!asking ? (
        <button type="button" className="tcc-trigger" onClick={() => setAsking(true)}>
          Cancelar esta clase
        </button>
      ) : (
        <div className="tcc-confirm" role="group" aria-label="Confirmar la cancelación de la clase">
          <h3>¿Cancelar la clase del {classLabel}?</h3>
          {paid ? (
            <p className="tcc-refund">
              El alumno recibe el reembolso total{price != null ? ` (${formatPesos(price)})` : ""}, aunque falte
              poco para la clase. Vos no cobrás esta clase.
            </p>
          ) : (
            <p>Esta clase todavía no tenía un pago aprobado, así que no hay nada para devolver.</p>
          )}
          <p>El horario queda libre y le avisamos al alumno por email. No se puede deshacer.</p>
          <label className="tcc-reason" htmlFor={reasonId}>
            Motivo (opcional, lo ve el alumno)
            <textarea
              id={reasonId}
              value={reason}
              maxLength={MAX_REASON_CHARS}
              disabled={working}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <div className="tcc-actions">
            <button type="button" className="tcc-danger" disabled={working} aria-busy={working} onClick={confirm}>
              {working ? "Cancelando…" : "Sí, cancelar la clase"}
            </button>
            <button type="button" className="tcc-keep" disabled={working} onClick={() => setAsking(false)}>
              No, mantenerla
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="tcc-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function doneMessage(refund: Extract<TutorCancelResult, { ok: true }>["refund"]) {
  if (!refund) return "Cancelamos la clase y liberamos el horario.";
  return refund.status === "aprobado"
    ? `Cancelamos la clase y le devolvimos ${formatPesos(refund.amount)} al alumno.`
    : "Cancelamos la clase. Estamos procesando el reembolso del alumno; te avisamos cuando esté listo.";
}
