"use client";

import { Logo } from "@/components/ui";

/** Error inesperado en cualquier página: se puede reintentar sin perder la sesión. */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="not-found">
      <Logo />
      <p className="eyebrow">Algo salió mal</p>
      <h1>
        No pudimos cargar
        <br />
        esta página.
      </h1>
      <p>Probá de nuevo. Si el problema sigue, volvé al inicio.</p>
      <button type="button" className="button button-primary" onClick={reset}>
        Reintentar
      </button>
    </main>
  );
}
