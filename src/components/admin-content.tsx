"use client";

import { useRef, useState } from "react";
import { Notice } from "@/components/management-ui";
import { ButtonLink, PageHeading, SampleBanner } from "@/components/ui";

const DEFAULT_TITLE = "Lo que hoy cuesta, mañana lo entendés.";
const DEFAULT_SUBTITLE = "Aprendé con alguien que sabe acompañarte.";

/** Editor del banner principal. Es una vista previa local: no publica nada. */
export function ContentManager() {
  const [image, setImage] = useState("");
  const [title, setTitle] = useState(DEFAULT_TITLE);
  const [subtitle, setSubtitle] = useState(DEFAULT_SUBTITLE);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dirty, setDirty] = useState(false);
  const [previewMobile, setPreviewMobile] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function chooseFile(file?: File) {
    if (!file) return;
    setError("");
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("Elegí una imagen JPG, PNG o WebP.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError("La imagen debe pesar menos de 8 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onerror = () =>
      setError("No pudimos leer la imagen. Probá con otro archivo.");
    reader.onload = () => {
      setImage(String(reader.result));
      setFileName(file.name);
      setDirty(true);
      setNotice("");
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="mgmt-page">
      <PageHeading
        eyebrow="CONTENIDO DEL SITIO"
        title="Una buena primera impresión."
        description="Prepará las imágenes y el mensaje que reciben a la comunidad."
      >
        <ButtonLink href="/" variant="secondary">
          Ver sitio <span aria-hidden="true">↗</span>
        </ButtonLink>
      </PageHeading>
      <SampleBanner>
        La gestión de contenido todavía no está conectada: la vista previa es
        local y no cambia nada en el sitio publicado.
      </SampleBanner>
      <div className="mgmt-content-layout">
        <section className="mgmt-banner-section">
          <div className="mgmt-section-heading">
            <h2>Banner principal</h2>
            <div
              className="mgmt-device-toggle"
              aria-label="Tamaño de vista previa"
            >
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
          <div
            className={`mgmt-banner-preview ${previewMobile ? "is-mobile" : ""}`}
          >
            {image ? (
              // La vista previa usa un data URL local: next/image no aplica.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={image}
                alt="Vista previa de la imagen seleccionada para el banner"
              />
            ) : (
              <div className="mgmt-banner-illustration" aria-hidden="true">
                <span className="mgmt-banner-orbit" />
                <span className="mgmt-banner-spark">✳</span>
                <span className="mgmt-banner-book">
                  a²
                  <br />
                  <i>+ b²</i>
                </span>
              </div>
            )}
            <div className="mgmt-banner-copy">
              <span>ESTUDIAPP</span>
              <h3>{title || "Tu próximo mensaje empieza acá."}</h3>
              <p>{subtitle}</p>
            </div>
          </div>
          <p className="mgmt-preview-caption">
            <span className="mgmt-status-dot" />
            Vista previa local · Los cambios no están publicados.
          </p>
          <div
            className="mgmt-upload"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              chooseFile(event.dataTransfer.files[0]);
            }}
          >
            <span className="mgmt-upload-symbol" aria-hidden="true">
              ↑
            </span>
            <div>
              <strong>{fileName || "Una imagen para empezar"}</strong>
              <p>Arrastrá una imagen o elegila desde tu equipo.</p>
              <small>JPG, PNG o WebP · hasta 8 MB</small>
            </div>
            <button
              type="button"
              className="mgmt-button mgmt-button-secondary"
              onClick={() => fileRef.current?.click()}
            >
              {image ? "Cambiar imagen" : "Elegir imagen"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="mgmt-sr-only"
              aria-label="Seleccionar imagen de banner"
              onChange={(event) => chooseFile(event.target.files?.[0])}
            />
          </div>
          {error && (
            <p className="mgmt-field-error" role="alert">
              {error}
            </p>
          )}
        </section>
        <aside className="mgmt-content-form">
          <span className="mgmt-small-label">EL MENSAJE</span>
          <h2>
            Claro. Cercano.{" "}
            <br />
            Bien nuestro.
          </h2>
          <label className="mgmt-field">
            Título
            <textarea
              rows={3}
              maxLength={90}
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                setDirty(true);
              }}
            />
            <span className="mgmt-field-hint">{title.length}/90 caracteres</span>
          </label>
          <label className="mgmt-field">
            Texto de apoyo
            <textarea
              rows={3}
              maxLength={130}
              value={subtitle}
              onChange={(event) => {
                setSubtitle(event.target.value);
                setDirty(true);
              }}
            />
          </label>
          <button
            type="button"
            className="mgmt-button"
            disabled={!dirty || !title.trim()}
            onClick={() => {
              setDirty(false);
              setNotice(
                "Es una vista de muestra: no se publicó contenido en el sitio.",
              );
            }}
          >
            Guardar cambios <span aria-hidden="true">✓</span>
          </button>
          <button
            type="button"
            className="mgmt-text-button"
            onClick={() => {
              setImage("");
              setTitle(DEFAULT_TITLE);
              setSubtitle(DEFAULT_SUBTITLE);
              setFileName("");
              setDirty(false);
              setError("");
              setNotice("Se restableció el banner de muestra.");
              if (fileRef.current) fileRef.current.value = "";
            }}
          >
            Restablecer original
          </button>
          <p className="mgmt-content-advice">
            Elegí imágenes con aire y textos breves. La legibilidad también es
            parte de nuestra identidad.
          </p>
        </aside>
      </div>
      <Notice message={notice} />
    </div>
  );
}
