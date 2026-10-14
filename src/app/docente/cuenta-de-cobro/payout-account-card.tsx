"use client";

import { useEffect, useId, useRef, useState, useTransition, type KeyboardEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui";
import type { AccountNotice } from "@/lib/payments/account-notice";
import { unlinkPayoutAccount } from "./actions";
import type { PayoutAccountView } from "./state";

/**
 * Tarjeta «Cuenta de cobro» del panel docente: vincular la cuenta de Mercado Pago, ver su estado y
 * desvincularla. El estado viene del servidor (`PayoutAccountView`); acá solo hay interacción.
 */

/** Comienza la vinculación: es una redirección del servidor, por eso un enlace común y NO `next/link`
 *  (que precargaría la ruta y dejaría una cookie de estado sin que el docente haya apretado nada). */
const CONNECT_PATH = "/api/mercadopago/oauth/start";

const NOTICE_COPY: Record<AccountNotice, { tone: "success" | "info" | "error"; text: string }> = {
  vinculada: {
    tone: "success",
    text: "Listo, tu cuenta de Mercado Pago quedó vinculada. El pago de tus clases va a llegar directo a ella.",
  },
  cancelada: {
    tone: "info",
    text: "No se vinculó ninguna cuenta porque cancelaste la autorización en Mercado Pago. Podés intentarlo de nuevo cuando quieras.",
  },
  ya_vinculada: {
    tone: "error",
    text: "Esa cuenta de Mercado Pago ya está vinculada a otro docente de EstudiApp. Probá con una cuenta a tu nombre o escribinos si creés que es un error.",
  },
  cambio_bloqueado: {
    tone: "error",
    text: "No pudimos cambiar tu cuenta de cobro porque tenés clases por dar o reembolsos en curso con la cuenta actual. Cuando se resuelvan, podés vincular la nueva.",
  },
  error: {
    tone: "error",
    text: "No pudimos vincular tu cuenta de Mercado Pago y no se guardó nada. Probá de nuevo en un momento.",
  },
  sin_configurar: {
    tone: "error",
    text: "Todavía no podemos vincular cuentas de Mercado Pago. Estamos terminando de configurarlo: volvé a intentarlo más tarde.",
  },
};

const NOTICE_SYMBOL = { success: "✓", info: "i", error: "!" } as const;

/** Resultado de la vinculación (`?cuenta=`): claro y descartable. Al cerrarlo se limpia la dirección. */
export function PayoutAccountNotice({ notice }: { notice: AccountNotice | null }) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(false);
  if (!notice || dismissed) return null;

  const { tone, text } = NOTICE_COPY[notice];
  return (
    <div className={`mgmt-payout-notice mgmt-payout-notice-${tone}`} role={tone === "error" ? "alert" : "status"}>
      <span className="mgmt-payout-notice-symbol" aria-hidden="true">
        {NOTICE_SYMBOL[tone]}
      </span>
      <p>{text}</p>
      <button
        type="button"
        className="mgmt-payout-notice-close"
        aria-label="Cerrar aviso"
        onClick={() => {
          setDismissed(true);
          // Sin el parámetro, actualizar la página no vuelve a mostrar el aviso.
          router.replace("/docente", { scroll: false });
        }}
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}

/** Recordatorio breve (fuera de la pestaña) para el docente que todavía no puede recibir reservas. */
export function PayoutAccountReminder({
  status,
  onOpen,
}: {
  status: PayoutAccountView["status"];
  onOpen: () => void;
}) {
  if (status !== "sin_vincular" && status !== "vencida") return null;
  return (
    <div className="mgmt-payout-nudge" role="note">
      <span className="mgmt-payout-notice-symbol" aria-hidden="true">
        !
      </span>
      <p>
        {status === "vencida" ? (
          <>
            <strong>Tu vinculación con Mercado Pago venció.</strong> Volvé a vincularla para que puedan reservar tus
            horarios.
          </>
        ) : (
          <>
            <strong>Tus horarios todavía no se pueden reservar.</strong> Vinculá tu cuenta de Mercado Pago para
            empezar a recibir clases.
          </>
        )}
      </p>
      <button type="button" className="mgmt-text-button" onClick={onOpen}>
        Ir a Cuenta de cobro <span aria-hidden="true">→</span>
      </button>
    </div>
  );
}

export function PayoutAccountPanel({ view, notice }: { view: PayoutAccountView; notice: AccountNotice | null }) {
  const headingId = useId();
  return (
    <>
      <PayoutAccountNotice notice={notice} />
      <section className="mgmt-payment-panel" aria-labelledby={headingId}>
        <div>
          <span className="mgmt-small-label">TUS CLASES, TUS COBROS</span>
          <h2 id={headingId}>Cobrá directo en tu cuenta.</h2>
          <p>
            El pago de cada clase te llega directo a tu cuenta de Mercado Pago. EstudiApp retiene una comisión del
            12 % de cada clase. Sin una cuenta vinculada, los estudiantes no pueden reservar tus horarios.
          </p>
          <ul className="mgmt-check-list">
            <li>Una cuenta de Mercado Pago a tu nombre</li>
            <li>Mercado Pago aplica su propia tarifa de procesamiento sobre lo que cobrás</li>
            <li>Vinculás una sola vez y podés desvincularla cuando no tengas clases por dar</li>
          </ul>
        </div>
        <PayoutAccountCard view={view} />
      </section>
    </>
  );
}

function ConnectLink({ children }: { children: ReactNode }) {
  return (
    <a className="mgmt-button mgmt-payout-cta" href={CONNECT_PATH}>
      {children} <span aria-hidden="true">↗</span>
    </a>
  );
}

const STATUS_BADGE = {
  sin_vincular: { tone: "orange", label: "Sin cuenta vinculada" },
  vinculada: { tone: "green", label: "Cuenta vinculada" },
  vencida: { tone: "orange", label: "Vinculación vencida" },
  no_disponible: { tone: "muted", label: "Estado no disponible" },
} as const;

function PayoutAccountCard({ view }: { view: PayoutAccountView }) {
  const { status, maskedAccount } = view;
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [pending, startTransition] = useTransition();
  const unlinkButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const doneMessage = useRef<HTMLParagraphElement>(null);
  const confirmId = useId();

  // Al abrir la confirmación el foco va a «Cancelar» (la opción segura); al resultado, a su mensaje.
  useEffect(() => {
    if (confirming) cancelButton.current?.focus();
  }, [confirming]);
  useEffect(() => {
    if (done) doneMessage.current?.focus();
  }, [done]);

  function cancel() {
    setConfirming(false);
    setError("");
    // El botón de desvincular vuelve a existir recién en el próximo render.
    requestAnimationFrame(() => unlinkButton.current?.focus());
  }

  function confirmUnlink() {
    setError("");
    startTransition(async () => {
      const result = await unlinkPayoutAccount();
      if (result.ok) {
        setConfirming(false);
        setDone("Desvinculamos tu cuenta de Mercado Pago.");
      } else {
        setConfirming(false);
        setError(result.error);
      }
    });
  }

  function onConfirmKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !pending) cancel();
  }

  const badge = STATUS_BADGE[status];
  const canUnlink = status === "vinculada" || status === "vencida";

  return (
    <div className="mgmt-payment-form">
      <div className="mgmt-payment-logo" aria-hidden="true">
        mp
      </div>
      <h3>Mercado Pago</h3>
      <Badge tone={badge.tone}>{badge.label}</Badge>

      {status === "sin_vincular" && (
        <>
          <p>
            Vinculala una sola vez: te llevamos a Mercado Pago para que autorices a EstudiApp a cobrar tus clases por
            vos.
          </p>
          <ConnectLink>Conectar mi cuenta de Mercado Pago</ConnectLink>
        </>
      )}

      {status === "vinculada" && (
        <>
          <p>
            Cuenta de Mercado Pago <strong>{maskedAccount ?? "vinculada"}</strong>
          </p>
          <p>El pago de tus clases llega directo a esta cuenta.</p>
        </>
      )}

      {status === "vencida" && (
        <>
          <p>
            La autorización de tu cuenta{maskedAccount ? <> <strong>{maskedAccount}</strong></> : null} venció. Volvé a
            vincularla para que los estudiantes puedan reservar tus horarios.
          </p>
          <ConnectLink>Volver a vincular mi cuenta</ConnectLink>
        </>
      )}

      {status === "no_disponible" && (
        <p>No pudimos revisar el estado de tu cuenta de cobro. Actualizá la página en un momento.</p>
      )}

      {canUnlink &&
        (confirming ? (
          <div
            className="mgmt-payout-confirm"
            role="group"
            aria-labelledby={confirmId}
            onKeyDown={onConfirmKeyDown}
          >
            <strong id={confirmId}>¿Querés desvincular tu cuenta?</strong>
            <p>
              Mientras no haya una cuenta vinculada, los estudiantes no van a poder reservar tus horarios. Si tenés
              clases por dar o reembolsos en curso, todavía no vas a poder hacerlo.
            </p>
            <div className="mgmt-payout-actions">
              <button
                type="button"
                className="mgmt-button mgmt-button-rust"
                onClick={confirmUnlink}
                disabled={pending}
              >
                {pending ? "Desvinculando…" : "Sí, desvincular"}
              </button>
              <button
                ref={cancelButton}
                type="button"
                className="mgmt-text-button"
                onClick={cancel}
                disabled={pending}
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <button
            ref={unlinkButton}
            type="button"
            className="mgmt-button mgmt-button-secondary"
            onClick={() => {
              setDone("");
              setConfirming(true);
            }}
          >
            Desvincular cuenta
          </button>
        ))}

      {error && (
        <p className="mgmt-field-error" role="alert">
          {error}
        </p>
      )}
      {done && (
        <p className="mgmt-payout-done" role="status" tabIndex={-1} ref={doneMessage}>
          {done}
        </p>
      )}

      <small>
        {status === "sin_vincular" || status === "vencida"
          ? "Es una autorización para cobrar por vos: nunca vemos tu contraseña de Mercado Pago."
          : "Mercado Pago es quien procesa los pagos; EstudiApp nunca ve tu contraseña."}
      </small>
    </div>
  );
}
