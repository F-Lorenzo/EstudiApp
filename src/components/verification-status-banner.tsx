const COPY: Record<string, { label: string; className: string }> = {
  pendiente: {
    label: "Tu perfil está pendiente de aprobación. No es visible en el catálogo todavía.",
    className: "bg-amber-50 text-amber-800 border-amber-200",
  },
  aprobado: {
    label: "Tu perfil está aprobado y visible en el catálogo.",
    className: "bg-green-50 text-green-800 border-green-200",
  },
  rechazado: {
    label: "Tu perfil fue rechazado.",
    className: "bg-red-50 text-red-800 border-red-200",
  },
};

export function VerificationStatusBanner({
  status,
  reason,
}: {
  status: string;
  reason?: string | null;
}) {
  const copy = COPY[status] ?? COPY.pendiente;

  return (
    <div className={`rounded border p-3 text-sm ${copy.className}`}>
      <p>{copy.label}</p>
      {status === "rechazado" && reason && (
        <p className="mt-1">Motivo: {reason}</p>
      )}
    </div>
  );
}
