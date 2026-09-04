const COPY: Record<string, { tag: string; label: string }> = {
  pendiente: {
    tag: "PENDIENTE",
    label: "Tu perfil está pendiente de aprobación. No es visible en el catálogo todavía.",
  },
  aprobado: {
    tag: "APROBADO",
    label: "Tu perfil está aprobado y visible en el catálogo.",
  },
  rechazado: {
    tag: "RECHAZADO",
    label: "Tu perfil fue rechazado.",
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
    <div className="border-2 border-black p-3 text-sm">
      <p>
        <span className="font-bold">[{copy.tag}]</span> {copy.label}
      </p>
      {status === "rechazado" && reason && (
        <p className="mt-1">Motivo: {reason}</p>
      )}
    </div>
  );
}
