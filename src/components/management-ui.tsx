"use client";

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
