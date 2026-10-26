"use client";

import { useActionState, useState } from "react";
import { saveSiteContent } from "@/app/admin/contenido/actions";
import { FieldError } from "@/components/field-error";
import { ButtonLink, PageHeading } from "@/components/ui";
import {
  ANNOUNCEMENT_LIMITS,
  DEFAULT_HERO,
  HERO_LIMITS,
  type SiteContentRow,
} from "@/lib/content/site-content";
import { initialActionState } from "@/lib/validation/form-state";

/** Fecha guardada (fin del día en Argentina) → valor de un `<input type="date">`. */
function dateInputValue(iso: string | null) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(iso));
}

/**
 * Editor del contenido de la Home (migración 0022): el texto del hero y la franja de anuncio. La pizarra, la
 * mascota y el diseño del hero son fijos (decisión de marca); acá solo se cambian las palabras. Un campo del
 * hero vacío usa el texto original.
 */
export function ContentManager({ content }: { content: SiteContentRow }) {
  const [state, formAction, pending] = useActionState(saveSiteContent, initialActionState);
  const [title, setTitle] = useState(state.values?.heroTitle ?? content.heroTitle ?? "");
  const [highlight, setHighlight] = useState(state.values?.heroHighlight ?? content.heroHighlight ?? "");
  const [description, setDescription] = useState(state.values?.heroDescription ?? content.heroDescription ?? "");
  const [previewMobile, setPreviewMobile] = useState(false);

  const shownLines = (title.trim() || DEFAULT_HERO.title)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, HERO_LIMITS.titleLines);

  return (
    <div className="mgmt-page">
      <PageHeading
        eyebrow="CONTENIDO DEL SITIO"
        title="Una buena primera impresión."
        description="El mensaje del inicio y los anuncios para la comunidad. La pizarra y la mascota no cambian: son parte de nuestra identidad."
      >
        <ButtonLink href="/" variant="secondary">
          Ver sitio <span aria-hidden="true">↗</span>
        </ButtonLink>
      </PageHeading>
      <form action={formAction} className="mgmt-content-layout">
        <section className="mgmt-banner-section">
          <div className="mgmt-section-heading">
            <h2>Texto del inicio</h2>
            <div className="mgmt-device-toggle" aria-label="Tamaño de vista previa">
              <button
                type="button"
                className={!previewMobile ? "is-active" : ""}
                aria-pressed={!previewMobile}
                onClick={() => setPreviewMobile(false)}
              >
                Escritorio
              </button>
              <button
                type="button"
                className={previewMobile ? "is-active" : ""}
                aria-pressed={previewMobile}
                onClick={() => setPreviewMobile(true)}
              >
                Móvil
              </button>
            </div>
          </div>
          <div className={`mgmt-banner-preview ${previewMobile ? "is-mobile" : ""}`} aria-label="Vista previa del inicio">
            <div className="mgmt-banner-illustration" aria-hidden="true">
              <span className="mgmt-banner-orbit" />
              <span className="mgmt-banner-spark">✳</span>
            </div>
            <div className="mgmt-banner-copy">
              <span>EXPERIENCIA QUE SE COMPARTE</span>
              <h3>
                {shownLines.map((line, index) => (
                  <span key={index} className="mgmt-preview-line">
                    {line}
                  </span>
                ))}
                <span className="mgmt-preview-highlight">{highlight.trim() || DEFAULT_HERO.highlight}</span>
              </h3>
              <p>{description.trim() || DEFAULT_HERO.description}</p>
            </div>
          </div>
          <p className="mgmt-preview-caption">
            <span className="mgmt-status-dot" />
            Vista previa · Se publica al guardar.
          </p>
          <div className="mgmt-content-fields">
            <label className="mgmt-field">
              Título (hasta {HERO_LIMITS.titleLines} renglones)
              <textarea
                name="heroTitle"
                rows={3}
                maxLength={HERO_LIMITS.title}
                value={title}
                placeholder={DEFAULT_HERO.title}
                onChange={(event) => setTitle(event.target.value)}
                aria-invalid={state.fieldErrors?.heroTitle ? true : undefined}
              />
              <span className="mgmt-field-hint">
                {title.length}/{HERO_LIMITS.title} · Vacío: «{DEFAULT_HERO.title.replace("\n", " ")}»
              </span>
              <FieldError messages={state.fieldErrors?.heroTitle} />
            </label>
            <label className="mgmt-field">
              Frase subrayada
              <input
                name="heroHighlight"
                maxLength={HERO_LIMITS.highlight}
                value={highlight}
                placeholder={DEFAULT_HERO.highlight}
                onChange={(event) => setHighlight(event.target.value)}
                aria-invalid={state.fieldErrors?.heroHighlight ? true : undefined}
              />
              <span className="mgmt-field-hint">
                {highlight.length}/{HERO_LIMITS.highlight} · Va al final del título, subrayada en naranja.
              </span>
              <FieldError messages={state.fieldErrors?.heroHighlight} />
            </label>
            <label className="mgmt-field">
              Texto de apoyo
              <textarea
                name="heroDescription"
                rows={3}
                maxLength={HERO_LIMITS.description}
                value={description}
                placeholder={DEFAULT_HERO.description}
                onChange={(event) => setDescription(event.target.value)}
                aria-invalid={state.fieldErrors?.heroDescription ? true : undefined}
              />
              <span className="mgmt-field-hint">
                {description.length}/{HERO_LIMITS.description}
              </span>
              <FieldError messages={state.fieldErrors?.heroDescription} />
            </label>
          </div>
        </section>
        <aside className="mgmt-content-form">
          <span className="mgmt-small-label">FRANJA DE ANUNCIO</span>
          <h2>
            Algo para contar,{" "}
            <br />
            arriba de todo.
          </h2>
          <label className="mgmt-check">
            <input
              type="checkbox"
              name="announcementEnabled"
              defaultChecked={content.announcementEnabled}
            />
            <span>
              <strong>Mostrar el anuncio</strong>
              <small>Aparece arriba del inicio, en todas las pantallas.</small>
            </span>
          </label>
          <label className="mgmt-field">
            Anuncio
            <textarea
              name="announcementText"
              rows={3}
              maxLength={ANNOUNCEMENT_LIMITS.text}
              defaultValue={state.values?.announcementText ?? content.announcementText ?? ""}
              placeholder="Por ejemplo: Ya podés reservar clases para el segundo cuatrimestre."
              aria-invalid={state.fieldErrors?.announcementText ? true : undefined}
            />
            <FieldError messages={state.fieldErrors?.announcementText} />
          </label>
          <label className="mgmt-field">
            Texto del enlace (opcional)
            <input
              name="announcementLinkLabel"
              maxLength={ANNOUNCEMENT_LIMITS.linkLabel}
              defaultValue={state.values?.announcementLinkLabel ?? content.announcementLinkLabel ?? ""}
              placeholder="Ver docentes"
              aria-invalid={state.fieldErrors?.announcementLinkLabel ? true : undefined}
            />
            <FieldError messages={state.fieldErrors?.announcementLinkLabel} />
          </label>
          <label className="mgmt-field">
            Dirección del enlace
            <input
              name="announcementLinkUrl"
              maxLength={ANNOUNCEMENT_LIMITS.linkUrl}
              defaultValue={state.values?.announcementLinkUrl ?? content.announcementLinkUrl ?? ""}
              placeholder="/docentes o https://…"
              aria-invalid={state.fieldErrors?.announcementLinkUrl ? true : undefined}
            />
            <FieldError messages={state.fieldErrors?.announcementLinkUrl} />
          </label>
          <label className="mgmt-field">
            Se muestra hasta el (opcional)
            <input
              type="date"
              name="announcementEndsAt"
              defaultValue={state.values?.announcementEndsAt ?? dateInputValue(content.announcementEndsAt)}
              aria-invalid={state.fieldErrors?.announcementEndsAt ? true : undefined}
            />
            <span className="mgmt-field-hint">Inclusive, en hora de Argentina. Vacío: hasta que lo apagues.</span>
            <FieldError messages={state.fieldErrors?.announcementEndsAt} />
          </label>
          {state.error && (
            <p className="mgmt-field-error" role="alert">
              {state.error}
            </p>
          )}
          {state.success && (
            <p className="mgmt-field-hint" role="status">
              Publicado. Ya se ve en el inicio.
            </p>
          )}
          <button type="submit" className="mgmt-button" disabled={pending}>
            {pending ? "Publicando…" : "Publicar cambios"} <span aria-hidden="true">✓</span>
          </button>
          <p className="mgmt-content-advice">
            Textos breves y claros. Para volver al mensaje original, dejá vacíos los campos del inicio.
          </p>
        </aside>
      </form>
    </div>
  );
}
