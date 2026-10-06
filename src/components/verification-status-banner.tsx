import Link from "next/link";

const COPY = {
  aprobado: {
    tone: "approved",
    symbol: "✓",
    title: "Tu experiencia ya está verificada",
    text: "Tu perfil está aprobado y visible en el catálogo. Seguí compartiendo lo que sabés.",
  },
  pendiente: {
    tone: "pending",
    symbol: "◷",
    title: "Estamos revisando tu perfil",
    text: "Tu perfil está pendiente de aprobación y todavía no es visible en el catálogo. Podés preparar tu agenda; la publicación se habilita al aprobarlo.",
  },
  rechazado: {
    tone: "rejected",
    symbol: "!",
    title: "Tu perfil necesita un ajuste",
    text: "El equipo revisó tu solicitud y necesita que ajustes tu perfil.",
  },
} as const;

type Status = keyof typeof COPY;

/** Estado de verificación del perfil docente. `action` agrega un enlace a la derecha. */
export function VerificationStatusBanner({
  status,
  reason,
  action,
}: {
  status: string;
  reason?: string | null;
  action?: { href: string; label: string };
}) {
  const copy = COPY[(status in COPY ? status : "pendiente") as Status];

  return (
    <div className={`mgmt-approval mgmt-approval-${copy.tone}`}>
      <span className="mgmt-approval-symbol" aria-hidden="true">
        {copy.symbol}
      </span>
      <div>
        <strong>{copy.title}</strong>
        <p>
          {copy.text}
          {status === "rechazado" && reason ? ` Motivo: ${reason}` : ""}
        </p>
      </div>
      {action && (
        <Link href={action.href}>
          {action.label} <span aria-hidden="true">↗</span>
        </Link>
      )}
    </div>
  );
}
