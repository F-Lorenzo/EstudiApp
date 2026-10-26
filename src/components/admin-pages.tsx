"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import {
  approveTutor,
  deactivateTutor,
  rejectTutor,
  reopenTutor,
} from "@/app/admin/docentes/[id]/actions";
import { FieldError } from "@/components/field-error";
import { Avatar, Badge, EmptyState, PageHeading } from "@/components/ui";
import type { AuditEntry } from "@/lib/admin/audit";
import { money } from "@/lib/format";
import type { AdminTutorRow } from "@/lib/tutors/queries";
import { initialActionState, type ActionState } from "@/lib/validation/form-state";
import { MODERATION_REASON_MAX } from "@/lib/validation/moderation";

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

/** Perfiles rechazados o dados de baja, con su motivo. Se reabren desde la ficha. */
export function RejectedTeachers({ rows }: { rows: AdminTutorRow[] }) {
  const [query, setQuery] = useState("");
  const filtered = rows.filter((row) => matches(row, query));

  return (
    <div className="mgmt-page">
      <PageHeading
        eyebrow="PERFILES RECHAZADOS"
        title="Cada decisión, con su motivo."
        description="Los perfiles rechazados y los dados de baja. Desde la ficha podés reabrir uno para revisarlo de nuevo."
      >
        <span className="mgmt-count-tag">
          {rows.length} {rows.length === 1 ? "perfil" : "perfiles"}
        </span>
      </PageHeading>
      <div className="mgmt-list-toolbar">
        <label className="mgmt-search">
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            placeholder="Buscar por nombre o materia"
            aria-label="Buscar perfiles rechazados"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <span>Más recientes primero</span>
      </div>
      <div className="mgmt-request-list">
        {filtered.length ? (
          filtered.map((row) => (
            <Link
              key={row.id}
              href={`/admin/docentes/${row.id}`}
              className="mgmt-request-row mgmt-rejected-row"
            >
              <Avatar name={row.name} src={row.photo ?? undefined} />
              <div className="mgmt-request-person">
                <h2>{row.name}</h2>
                <p>{row.subjects.join(", ") || "Sin materias cargadas"}</p>
                {row.reason && <p className="mgmt-rejected-reason">Motivo: {row.reason}</p>}
              </div>
              <div className="mgmt-request-meta">
                <Badge tone="muted">Rechazado</Badge>
                <span>Actualizado {row.updatedAgo}</span>
              </div>
              <span className="mgmt-row-arrow" aria-hidden="true">
                ↗
              </span>
            </Link>
          ))
        ) : (
          <EmptyState
            title={query ? "No encontramos ese perfil" : "No hay perfiles rechazados"}
            description={
              query
                ? "Probá con otro nombre o una materia."
                : "Cuando rechaces una solicitud o des de baja a un docente, aparece acá con su motivo."
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
          {filtered.length} {filtered.length === 1 ? "perfil" : "perfiles"}
        </span>
        <Link href="/admin/registro">Ver el registro de acciones ↗</Link>
      </div>
    </div>
  );
}

/** Formulario con un texto (motivo de rechazo o de baja, nota de reapertura) del panel de decisión. */
function ReasonForm({
  serverAction,
  name,
  label,
  placeholder,
  required,
  submit,
  pendingLabel,
  hint,
  tone,
  onCancel,
}: {
  serverAction: (state: ActionState, formData: FormData) => Promise<ActionState>;
  name: "reason" | "note";
  label: string;
  placeholder: string;
  required: boolean;
  submit: string;
  pendingLabel: string;
  hint?: string;
  tone: "rust" | "primary";
  onCancel: () => void;
}) {
  const [state, formAction, pending] = useActionState(serverAction, initialActionState);
  return (
    <form action={formAction}>
      <label className="mgmt-field">
        {label}
        <textarea
          name={name}
          rows={4}
          required={required}
          maxLength={MODERATION_REASON_MAX}
          defaultValue={state.values?.[name]}
          placeholder={placeholder}
          aria-invalid={state.fieldErrors?.[name] ? true : undefined}
        />
        <FieldError messages={state.fieldErrors?.[name]} />
      </label>
      {hint && <p className="mgmt-decision-hint">{hint}</p>}
      {state.error && (
        <p className="mgmt-field-error" role="alert">
          {state.error}
        </p>
      )}
      <button
        className={tone === "rust" ? "mgmt-button mgmt-button-rust" : "mgmt-button"}
        type="submit"
        disabled={pending}
      >
        {pending ? pendingLabel : submit}
      </button>
      <button className="mgmt-text-button" type="button" onClick={onCancel}>
        Cancelar
      </button>
    </form>
  );
}

/**
 * Panel de decisión de la ficha de un docente:
 *  - pendiente: aprobar o rechazar con motivo;
 *  - aprobado: dar de baja con motivo (deja de aparecer en el catálogo; sus clases confirmadas siguen en pie);
 *  - rechazado: reabrir, con una nota opcional para el registro (vuelve a la cola de revisión).
 */
export function DecisionPanel({
  tutorId,
  status,
  reason,
}: {
  tutorId: string;
  status: string;
  reason: string | null;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

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
      {status === "pendiente" ? (
        open ? (
          <ReasonForm
            serverAction={rejectTutor.bind(null, tutorId)}
            name="reason"
            label="Motivo de rechazo"
            placeholder="Indicá qué debería revisar o completar."
            required
            submit="Confirmar rechazo"
            pendingLabel="Rechazando…"
            hint="El docente recibe este motivo por email y puede corregir su perfil."
            tone="rust"
            onCancel={close}
          />
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
              onClick={() => setOpen(true)}
            >
              Rechazar solicitud
            </button>
          </div>
        )
      ) : (
        <div className="mgmt-decision-result">
          <Badge tone={status === "aprobado" ? "green" : "orange"}>
            {status === "aprobado" ? "Perfil aprobado" : "Perfil rechazado"}
          </Badge>
          <p>
            {status === "aprobado"
              ? "El perfil es visible en el catálogo."
              : reason
                ? `Motivo: ${reason}`
                : "Sin motivo registrado."}
          </p>
          {open ? (
            status === "aprobado" ? (
              <ReasonForm
                serverAction={deactivateTutor.bind(null, tutorId)}
                name="reason"
                label="Motivo de la baja"
                placeholder="Contá por qué se da de baja el perfil."
                required
                submit="Confirmar baja"
                pendingLabel="Dando de baja…"
                hint="Deja de aparecer en el catálogo y recibe este motivo por email. Sus clases ya confirmadas siguen en pie: si hay que cancelarlas, se hace una por una."
                tone="rust"
                onCancel={close}
              />
            ) : (
              <ReasonForm
                serverAction={reopenTutor.bind(null, tutorId)}
                name="note"
                label="Nota para el registro (opcional)"
                placeholder="Por ejemplo: mandó el título por mail."
                required={false}
                submit="Reabrir perfil"
                pendingLabel="Reabriendo…"
                hint="El perfil vuelve a la cola de solicitudes y el docente recibe un email. La nota no se le muestra."
                tone="primary"
                onCancel={close}
              />
            )
          ) : (
            <button
              type="button"
              className="mgmt-button mgmt-button-secondary"
              onClick={() => setOpen(true)}
            >
              {status === "aprobado" ? "Dar de baja" : "Reabrir perfil"}
            </button>
          )}
        </div>
      )}
    </aside>
  );
}

/** Historial de decisiones de un perfil, de lo más nuevo a lo más viejo. */
export function TutorHistory({ entries }: { entries: AuditEntry[] }) {
  return (
    <section className="mgmt-history" aria-labelledby="mgmt-history-title">
      <span className="mgmt-small-label" id="mgmt-history-title">
        HISTORIAL DE DECISIONES
      </span>
      {entries.length ? (
        <ol>
          {entries.map((entry) => (
            <li key={entry.id}>
              <strong>{entry.label}</strong>
              <span>
                {entry.actor} · <time dateTime={entry.createdAt}>{entry.when}</time>
              </span>
              {entry.reason && <p>{entry.reason}</p>}
            </li>
          ))}
        </ol>
      ) : (
        <p>Todavía no hay decisiones registradas sobre este perfil.</p>
      )}
    </section>
  );
}

const TARGET_LABEL: Record<AuditEntry["targetType"], string> = {
  docente: "Docente",
  reserva: "Clase",
  cuenta: "Cuenta",
};

/** Registro de acciones de la administración (y los cambios de estado de los perfiles). */
export function AuditLog({ entries }: { entries: AuditEntry[] }) {
  return (
    <div className="mgmt-page">
      <PageHeading
        eyebrow="REGISTRO DE ACCIONES"
        title="Lo que se decide, queda."
        description="Cada aprobación, rechazo, reapertura, baja, clase cancelada y cambio de rol, con quién lo hizo y por qué. Nadie lo puede editar ni borrar."
      >
        <span className="mgmt-count-tag">Últimas {entries.length}</span>
      </PageHeading>
      <div className="mgmt-table-wrap">
        {entries.length ? (
          <table className="mgmt-table mgmt-audit-table">
            <thead>
              <tr>
                <th>Cuándo</th>
                <th>Quién</th>
                <th>Acción</th>
                <th>Sobre</th>
                <th>Motivo</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>
                    <time dateTime={entry.createdAt} title={entry.when}>
                      {entry.ago}
                    </time>
                    <span className="mgmt-audit-when">{entry.when}</span>
                  </td>
                  <td>{entry.actor}</td>
                  <td>
                    {entry.label}
                    {entry.change && <span className="mgmt-audit-when">{entry.change}</span>}
                  </td>
                  <td>
                    <span className="mgmt-audit-kind">{TARGET_LABEL[entry.targetType]}</span>
                    {entry.targetType === "docente" ? (
                      <Link href={`/admin/docentes/${entry.targetId}`} className="mgmt-text-button">
                        {entry.target ?? "Ver ficha"} ↗
                      </Link>
                    ) : (
                      (entry.target ?? "—")
                    )}
                  </td>
                  <td>{entry.reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState
            title="Todavía no hay acciones registradas"
            description="Cuando se apruebe, rechace o dé de baja un perfil, queda anotado acá."
          />
        )}
      </div>
    </div>
  );
}
