"use client";

import { useActionState, useState, type FormEvent } from "react";
import { FieldError } from "@/components/field-error";
import { Badge, ButtonLink, PageHeading } from "@/components/ui";
import { VerificationStatusBanner } from "@/components/verification-status-banner";
import { money } from "@/lib/format";
import { initialActionState } from "@/lib/validation/form-state";
import { updateTutorProfile } from "@/app/docente/perfil/actions";

type Subject = { id: string; name: string };

export type TutorProfileValues = {
  fullName: string;
  avatarUrl: string;
  bio: string;
  nivelAcademico: string;
  credentialUrl: string;
  tarifaPorClase: number;
  contactoVerificacion: string;
  selectedSubjectIds: string[];
};

type Draft = {
  fullName: string;
  avatarUrl: string;
  bio: string;
  subjectIds: string[];
  nivelAcademico: string;
  credentialUrl: string;
  tarifa: string;
  contacto: string;
};

/** En qué paso del formulario vive cada campo (para saltar al que tiene un error). */
const FIELD_STEP: Record<string, number> = {
  fullName: 0,
  avatarUrl: 0,
  bio: 0,
  subjectIds: 1,
  nivelAcademico: 1,
  credentialUrl: 1,
  tarifaPorClase: 2,
  contactoVerificacion: 2,
};

const STEPS = [
  ["Tu presentación", "Un poco sobre vos"],
  ["Tu experiencia", "Materias y formación"],
  ["Los últimos detalles", "Tarifa y contacto"],
];

function isUrl(value: string) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function validateStep(step: number, draft: Draft) {
  const errors: Record<string, string> = {};
  if (step === 0) {
    if (!draft.fullName.trim()) errors.fullName = "Contanos tu nombre.";
    if (draft.avatarUrl.trim() && !isUrl(draft.avatarUrl.trim()))
      errors.avatarUrl = "Ingresá una URL válida.";
    if (!draft.bio.trim()) errors.bio = "Contanos cómo enseñás.";
  }
  if (step === 1) {
    if (!draft.subjectIds.length) errors.subjectIds = "Elegí al menos una materia.";
    if (!draft.nivelAcademico.trim())
      errors.nivelAcademico = "Indicá tu título o nivel académico.";
    if (draft.credentialUrl.trim() && !isUrl(draft.credentialUrl.trim()))
      errors.credentialUrl = "Ingresá una URL válida.";
  }
  if (step === 2) {
    if (!(Number(draft.tarifa) > 0))
      errors.tarifaPorClase = "Ingresá una tarifa mayor a cero.";
    if (!draft.contacto.trim())
      errors.contactoVerificacion =
        "Dejanos un dato de contacto para verificarte.";
  }
  return errors;
}

export function TeacherOnboarding({
  values,
  subjects,
  status,
  reason,
}: {
  values: TutorProfileValues;
  subjects: Subject[];
  status: string;
  reason: string | null;
}) {
  const [state, formAction, pending] = useActionState(
    updateTutorProfile,
    initialActionState,
  );
  const [step, setStep] = useState(0);
  const [editing, setEditing] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<Draft>({
    fullName: values.fullName,
    avatarUrl: values.avatarUrl,
    bio: values.bio,
    subjectIds: values.selectedSubjectIds,
    nivelAcademico: values.nivelAcademico,
    credentialUrl: values.credentialUrl,
    tarifa: values.tarifaPorClase ? String(values.tarifaPorClase) : "",
    contacto: values.contactoVerificacion,
  });

  function update<K extends keyof Draft>(key: K, value: Draft[K], field: string) {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [field]: "" }));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const found = validateStep(step, draft);
    if (Object.keys(found).length) {
      event.preventDefault();
      setErrors(found);
      return;
    }
    if (step < 2) {
      event.preventDefault();
      setStep(step + 1);
      return;
    }
    // Último paso: se revisan todos antes de enviar al servidor.
    for (const index of [0, 1]) {
      const previous = validateStep(index, draft);
      if (Object.keys(previous).length) {
        event.preventDefault();
        setErrors(previous);
        setStep(index);
        return;
      }
    }
    setEditing(false);
  }

  const serverErrors = state.fieldErrors ?? {};
  const serverErrorStep = Object.keys(serverErrors)
    .filter((field) => serverErrors[field]?.length)
    .map((field) => FIELD_STEP[field] ?? 0)
    .sort()[0];
  const shown = (field: string) =>
    errors[field]
      ? [errors[field]]
      : serverErrors[field]?.length
        ? serverErrors[field]
        : undefined;

  // `pending` evita mostrar la pantalla de éxito vieja mientras se envía un nuevo guardado.
  if (state.success && !editing && !pending)
    return (
      <div className="mgmt-page mgmt-complete">
        <div className="mgmt-complete-stamp" aria-hidden="true">
          ✓
        </div>
        <span className="mgmt-small-label">UN NUEVO COMIENZO</span>
        <h1>
          Tu experiencia merece
          <br />
          ser compartida.
        </h1>
        <p>
          {status === "aprobado"
            ? "Guardamos tus cambios. Ya se ven en tu perfil público."
            : status === "pendiente"
              ? "Guardamos tu perfil. El equipo de EstudiApp lo va a revisar; mientras tanto no aparece en el catálogo."
              : "Guardamos tus cambios."}
        </p>
        <Badge
          tone={
            status === "aprobado"
              ? "green"
              : status === "rechazado"
                ? "muted"
                : "orange"
          }
        >
          {status === "aprobado"
            ? "Perfil aprobado"
            : status === "rechazado"
              ? "Perfil rechazado"
              : "Perfil en revisión"}
        </Badge>
        <div className="mgmt-complete-summary">
          <strong>{draft.fullName}</strong>
          <span>
            {subjects
              .filter((subject) => draft.subjectIds.includes(subject.id))
              .map((subject) => subject.name)
              .join(" · ")}
          </span>
          <span>{money(Number(draft.tarifa))} por clase</span>
        </div>
        <ButtonLink href="/docente">
          Ir a mi espacio <span aria-hidden="true">↗</span>
        </ButtonLink>
        <button
          type="button"
          className="mgmt-text-button"
          onClick={() => {
            setEditing(true);
            setStep(0);
          }}
        >
          Revisar mis datos
        </button>
      </div>
    );

  return (
    <div className="mgmt-page">
      <PageHeading
        eyebrow="TU PERFIL DOCENTE"
        title="Dale lugar a lo que sabés."
        description="Nos interesa tu experiencia y tu forma de enseñar. Hagamos que se conozcan."
      />
      <VerificationStatusBanner status={status} reason={reason} />
      <div className="mgmt-onboarding-layout">
        <aside className="mgmt-steps-aside">
          <ol className="mgmt-steps">
            {STEPS.map(([label, hint], index) => (
              <li
                key={label}
                className={
                  index === step ? "is-current" : index < step ? "is-done" : ""
                }
                aria-current={index === step ? "step" : undefined}
              >
                <span>{index < step ? "✓" : `0${index + 1}`}</span>
                <div>
                  <strong>{label}</strong>
                  <small>{hint}</small>
                </div>
              </li>
            ))}
          </ol>
          <div className="mgmt-onboarding-note">
            <span aria-hidden="true">✳</span>
            <p>
              Revisamos cada perfil antes de publicarlo. Podés volver y ajustar
              tus datos cuando quieras.
            </p>
          </div>
        </aside>
        <form
          className="mgmt-profile-form"
          action={formAction}
          onSubmit={onSubmit}
          noValidate
        >
          <div className="mgmt-form-top">
            <span className="mgmt-small-label">PASO {step + 1} DE 3</span>
            <span>Aproximadamente 5 minutos</span>
          </div>
          <h2>
            {
              [
                "Empecemos por conocerte.",
                "Lo que aprendiste, lo que enseñás.",
                "Casi listo para encontrarte.",
              ][step]
            }
          </h2>
          {state.error && (
            <p className="mgmt-field-error" role="alert">
              {state.error}
            </p>
          )}
          {step === 2 && serverErrorStep !== undefined && (
            <p className="mgmt-field-error" role="alert">
              Hay datos para revisar en el paso {serverErrorStep + 1}.{" "}
              <button
                type="button"
                className="mgmt-text-button"
                onClick={() => setStep(serverErrorStep)}
              >
                Ir a ese paso
              </button>
            </p>
          )}

          <div className="mgmt-form-fields" hidden={step !== 0}>
            <label className="mgmt-field">
              Nombre y apellido
              <input
                name="fullName"
                autoComplete="name"
                value={draft.fullName}
                onChange={(event) =>
                  update("fullName", event.target.value, "fullName")
                }
                placeholder="Tal como querés aparecer"
                aria-invalid={!!shown("fullName")}
              />
              <FieldError messages={shown("fullName")} />
            </label>
            <label className="mgmt-field">
              <span>
                Foto de perfil (enlace) <small>Opcional</small>
              </span>
              <input
                name="avatarUrl"
                type="url"
                value={draft.avatarUrl}
                onChange={(event) =>
                  update("avatarUrl", event.target.value, "avatarUrl")
                }
                placeholder="https://…"
                aria-invalid={!!shown("avatarUrl")}
              />
              <FieldError messages={shown("avatarUrl")} />
            </label>
            <label className="mgmt-field">
              Tu forma de enseñar
              <textarea
                name="bio"
                rows={5}
                value={draft.bio}
                onChange={(event) => update("bio", event.target.value, "bio")}
                placeholder="Contanos qué enseñás, cómo acompañás a tus estudiantes y qué te gusta de dar clases."
                aria-invalid={!!shown("bio")}
              />
              <span className="mgmt-field-hint">
                Una presentación cercana ayuda a dar el primer paso.{" "}
                {draft.bio.length} caracteres.
              </span>
              <FieldError messages={shown("bio")} />
            </label>
          </div>

          <div className="mgmt-form-fields" hidden={step !== 1}>
            <fieldset className="mgmt-subject-fieldset">
              <legend>¿Qué materias enseñás?</legend>
              <p>Podés elegir más de una.</p>
              <div className="mgmt-subject-options">
                {subjects.map((subject) => {
                  const selected = draft.subjectIds.includes(subject.id);
                  return (
                    <button
                      type="button"
                      key={subject.id}
                      aria-pressed={selected}
                      className={selected ? "is-selected" : ""}
                      onClick={() =>
                        update(
                          "subjectIds",
                          selected
                            ? draft.subjectIds.filter((id) => id !== subject.id)
                            : [...draft.subjectIds, subject.id],
                          "subjectIds",
                        )
                      }
                    >
                      {subject.name}
                      <span aria-hidden="true">{selected ? "✓" : "+"}</span>
                    </button>
                  );
                })}
              </div>
              {draft.subjectIds.map((id) => (
                <input key={id} type="hidden" name="subjectIds" value={id} />
              ))}
              <FieldError messages={shown("subjectIds")} />
            </fieldset>
            <label className="mgmt-field">
              Título o nivel académico
              <input
                name="nivelAcademico"
                value={draft.nivelAcademico}
                onChange={(event) =>
                  update("nivelAcademico", event.target.value, "nivelAcademico")
                }
                placeholder="Ej. Licenciada en Matemática, UBA"
                aria-invalid={!!shown("nivelAcademico")}
              />
              <FieldError messages={shown("nivelAcademico")} />
            </label>
            <label className="mgmt-field">
              <span>
                Respaldo de tu trayectoria (enlace) <small>Opcional</small>
              </span>
              <input
                name="credentialUrl"
                type="url"
                value={draft.credentialUrl}
                onChange={(event) =>
                  update("credentialUrl", event.target.value, "credentialUrl")
                }
                placeholder="https://…"
                aria-invalid={!!shown("credentialUrl")}
              />
              <span className="mgmt-field-hint">
                Un título, un CV o un perfil profesional que podamos consultar.
              </span>
              <FieldError messages={shown("credentialUrl")} />
            </label>
            <div className="mgmt-form-tip">
              <strong>La trayectoria se construye de muchas formas.</strong>
              <p>
                Podés incluir clases en instituciones, ayudantías y clases
                particulares.
              </p>
            </div>
          </div>

          <div className="mgmt-form-fields" hidden={step !== 2}>
            <label className="mgmt-field">
              Tarifa por clase
              <div className="mgmt-input-addon">
                <span>ARS $</span>
                <input
                  name="tarifaPorClase"
                  type="number"
                  min="1"
                  step="500"
                  placeholder="14500"
                  value={draft.tarifa}
                  onChange={(event) =>
                    update("tarifa", event.target.value, "tarifaPorClase")
                  }
                  aria-invalid={!!shown("tarifaPorClase")}
                />
              </div>
              <FieldError messages={shown("tarifaPorClase")} />
            </label>
            <label className="mgmt-field">
              Contacto para verificarte
              <input
                name="contactoVerificacion"
                autoComplete="email"
                placeholder="Un email o teléfono donde podamos escribirte"
                value={draft.contacto}
                onChange={(event) =>
                  update("contacto", event.target.value, "contactoVerificacion")
                }
                aria-invalid={!!shown("contactoVerificacion")}
              />
              <span className="mgmt-field-hint">
                Solo lo ve el equipo de EstudiApp.
              </span>
              <FieldError messages={shown("contactoVerificacion")} />
            </label>
            <div className="mgmt-review-mini">
              <span className="mgmt-small-label">ASÍ EMPIEZA TU PERFIL</span>
              <h3>{draft.fullName || "Tu nombre"}</h3>
              <p>{draft.nivelAcademico}</p>
              <div className="mgmt-tags">
                {subjects
                  .filter((subject) => draft.subjectIds.includes(subject.id))
                  .map((subject) => (
                    <Badge key={subject.id} tone="green">
                      {subject.name}
                    </Badge>
                  ))}
              </div>
            </div>
            <p className="mgmt-field-hint">
              Al guardarlo, tu perfil queda para revisión. Vas a poder publicar
              horarios cuando esté aprobado.
            </p>
          </div>

          <div className="mgmt-form-actions">
            {step ? (
              <button
                type="button"
                className="mgmt-text-button"
                onClick={() => setStep(step - 1)}
              >
                ← Anterior
              </button>
            ) : (
              <span />
            )}
            <button className="mgmt-button" type="submit" disabled={pending}>
              {step === 2
                ? pending
                  ? "Guardando…"
                  : "Guardar perfil"
                : "Continuar"}{" "}
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
