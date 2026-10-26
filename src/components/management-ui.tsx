"use client";

import type { ReactNode } from "react";

/**
 * Contenedor de una tabla que se desplaza de costado en pantallas chicas. Es enfocable para que se pueda recorrer
 * con el teclado, y tiene nombre para los lectores de pantalla.
 */
export function TableWrap({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mgmt-table-wrap" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

export function Notice({ message }: { message: string }) {
  return message ? (
    <div className="mgmt-notice" role="status">
      <span aria-hidden="true">✓</span>
      {message}
    </div>
  ) : null;
}

export function Tabs({
  items,
  value,
  onChange,
}: {
  items: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="mgmt-tabs" role="tablist" aria-label="Secciones">
      {items.map((item) => (
        <button
          key={item}
          type="button"
          role="tab"
          aria-selected={value === item}
          className={value === item ? "is-active" : ""}
          onClick={() => onChange(item)}
        >
          {item}
        </button>
      ))}
    </div>
  );
}
