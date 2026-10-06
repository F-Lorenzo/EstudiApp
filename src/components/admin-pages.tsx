"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { approveTutor, rejectTutor } from "@/app/admin/docentes/[id]/actions";
import { FieldError } from "@/components/field-error";
import { Avatar, Badge, EmptyState, PageHeading } from "@/components/ui";
import { money } from "@/lib/format";
import type { AdminTutorRow } from "@/lib/tutors/queries";
import { initialActionState } from "@/lib/validation/form-state";

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function matches(row: AdminTutorRow, query: string) {
  return normalize(`${row.name} ${row.subjects.join(" ")} ${row.title ?? ""}`).includes(
    normalize(query.trim()),
  );
}

/** Solicitudes de docentes pendientes de revisión. */
export function PendingTeachers({ rows }: { rows: AdminTutorRow[] }) {
  const [query, setQuery] = useState("");
  const filtered = rows.filter((row) => matches(row, query));

  return (
    <div className="mgmt-page">
      <PageHeading
        eyebrow="REVISIÓN DE DOCENTES"
        title="Hay experiencia por descubrir."
        description="Conocé a quienes quieren acompañar a la próxima generación de estudiantes."
      >
        <span className="mgmt-count-tag">{rows.length} por revisar</span>
      </PageHeading>
      <div className="mgmt-list-toolbar">
        <label className="mgmt-search">
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            placeholder="Buscar por nombre o materia"
            aria-label="Buscar solicitudes"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <span>Más antiguas primero</span>
      </div>
      <div className="mgmt-request-list">
        {filtered.length ? (
          filtered.map((row, index) => (
            <Link
              key={row.id}
              href={`/admin/docentes/${row.id}`}
              className="mgmt-request-row"
            >
              <span className="mgmt-request-index">
                {String(index + 1).padStart(2, "0")}
              </span>
              <Avatar name={row.name} src={row.photo ?? undefined} />
              <div className="mgmt-request-person">
                <h2>{row.name}</h2>
                <p>
                  {row.subjects.join(", ") || "Sin materias cargadas"}
                  {row.title && <span> · {row.title}</span>}
                </p>
              </div>
              <div className="mgmt-request-meta">
                <Badge tone={row.incomplete ? "muted" : "orange"}>
                  {row.incomplete ? "Perfil incompleto" : "Pendiente"}
                </Badge>
                <span>Se registró {row.ago}</span>
              </div>
              <span className="mgmt-row-arrow" aria-hidden="true">
                ↗
              </span>
            </Link>
          ))
        ) : (
          <EmptyState
            title={query ? "No encontramos esa solicitud" : "Todo al día por acá"}
            description={
              query
                ? "Probá con otro nombre o una materia."
                : "No hay solicitudes pendientes. Las nuevas aparecerán acá."
            }
          >
            {query && (
              <button
                type="button"
                className="mgmt-button mgmt-button-secondary"
                onClick={() => setQuery("")}
              >
                Limpiar búsqueda
              </button>
            )}
          </EmptyState>
        )}
      </div>
      <div className="mgmt-list-footnote">
        <span>
          {filtered.length} {filtered.length === 1 ? "solicitud" : "solicitudes"}
        </span>
        <p>Cada perfil se revisa individualmente. La trayectoria importa.</p>
      </div>
    </div>
  );
}

/** Docentes aprobados. */
export function ActiveTeachers({ rows }: { rows: AdminTutorRow[] }) {
  const [query, setQuery] = useState("");
  const filtered = rows.filter((row) => matches(row, query));

  return (
    <div className="mgmt-page">
      <PageHeading
        eyebrow="COMUNIDAD DOCENTE"
        title="Experiencia que se comparte."
        description="Los perfiles que forman parte de EstudiApp."
      >
        <Badge tone="green">
          {rows.length} {rows.length === 1 ? "perfil activo" : "perfiles activos"}
        </Badge>
      </PageHeading>
      <div className="mgmt-list-toolbar">
        <label className="mgmt-search">
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            placeholder="Buscar docente o materia"
            aria-label="Buscar docentes"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>
      <div className="mgmt-table-wrap">
        {filtered.length > 0 && (
          <table className="mgmt-table mgmt-teachers-table">
            <thead>
              <tr>
                <th>Docente</th>
                <th>Materias</th>
                <th>Valoración</th>
                <th>Tarifa / clase</th>
                <th>Estado</th>
                <th>
                  <span className="mgmt-sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div className="mgmt-person">
                      <Avatar name={row.name} src={row.photo ?? undefined} />
                      <div>
                        <strong>{row.name}</strong>
                        {row.title && <span>{row.title}</span>}
                      </div>
                    </div>
                  </td>
                  <td>{row.subjects.join(", ") || "—"}</td>
                  <td>
                    {row.rating > 0 ? (
                      <>
                        <span className="mgmt-star">★</span>{" "}
                        {row.rating.toFixed(1)}
                      </>
                    ) : (
                      "Sin valoraciones"
                    )}
                  </td>
                  <td>{money(row.price)}</td>
                  <td>
                    <Badge tone="green">Activo</Badge>
                  </td>
                  <td>
                    <div className="mgmt-table-actions">
                      <Link
                        href={`/docentes/${row.id}`}
                        className="mgmt-text-button"
                      >
                        Perfil público ↗
                      </Link>
                      <Link
                        href={`/admin/docentes/${row.id}`}
                        className="mgmt-text-button"
                      >
                        Ficha ↗
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!filtered.length && (
          <EmptyState
            title={
              query ? "No hay perfiles en esta búsqueda" : "Todavía no hay docentes aprobados"
            }
            description={
              query
                ? "Probá con otro nombre o materia."
                : "Cuando apruebes una solicitud, el perfil aparece acá."
            }
          >
            {query && (
              <button
                type="button"
                className="mgmt-button mgmt-button-secondary"
                onClick={() => setQuery("")}
              >
                Limpiar búsqueda
              </button>
            )}
          </EmptyState>
        )}
      </div>
      <div className="mgmt-list-footnote">
        <span>
          {filtered.length} {filtered.length === 1 ? "docente" : "docentes"}
        </span>
        <Link href="/admin/docentes/pendientes">
          Revisar nuevas solicitudes ↗
        </Link>
      </div>
    </div>
  );
}

/** Panel de decisión de la ficha de un docente: aprobar o rechazar con motivo. */
export function DecisionPanel({
  tutorId,
  status,
  reason,
}: {
  tutorId: string;
  status: string;
  reason: string | null;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [state, rejectAction, pending] = useActionState(
    rejectTutor.bind(null, tutorId),
    initialActionState,
  );

  return (
    <aside className="mgmt-decision-panel">
      <span className="mgmt-small-label">TU REVISIÓN</span>
      <h2>La confianza empieza acá.</h2>
      <p>
        Comprobá que la formación, la experiencia y las materias estén
        alineadas.
      </p>
      <ul className="mgmt-check-list">
        <li>Presentación clara y completa</li>
        <li>Experiencia relacionada</li>
        <li>Información de contacto</li>
      </ul>
      {status !== "pendiente" ? (
        <div className="mgmt-decision-result">
          <Badge tone={status === "aprobado" ? "green" : "orange"}>
            {status === "aprobado" ? "Perfil aprobado" : "Solicitud rechazada"}
          </Badge>
          <p>
            {status === "aprobado"
              ? "Esta solicitud ya fue revisada y el perfil es visible en el catálogo."
              : reason}
          </p>
        </div>
      ) : rejecting ? (
        <form action={rejectAction}>
          <label className="mgmt-field">
            Motivo de rechazo
            <textarea
              name="reason"
              rows={4}
              required
              defaultValue={state.values?.reason}
              placeholder="Indicá qué debería revisar o completar."
              aria-invalid={state.fieldErrors?.reason ? true : undefined}
            />
            <FieldError messages={state.fieldErrors?.reason} />
          </label>
          {state.error && (
            <p className="mgmt-field-error" role="alert">
              {state.error}
            </p>
          )}
          <button
            className="mgmt-button mgmt-button-rust"
            type="submit"
            disabled={pending}
          >
            {pending ? "Rechazando…" : "Confirmar rechazo"}
          </button>
          <button
            className="mgmt-text-button"
            type="button"
            onClick={() => setRejecting(false)}
          >
            Cancelar
          </button>
        </form>
      ) : (
        <div className="mgmt-decision-actions">
          <form action={approveTutor.bind(null, tutorId)}>
            <button className="mgmt-button" type="submit">
              Aprobar perfil <span aria-hidden="true">✓</span>
            </button>
          </form>
          <button
            type="button"
            className="mgmt-button mgmt-button-secondary"
            onClick={() => setRejecting(true)}
          >
            Rechazar solicitud
          </button>
        </div>
      )}
    </aside>
  );
}
