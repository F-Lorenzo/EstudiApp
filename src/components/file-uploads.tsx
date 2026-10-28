"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { Avatar, Icon } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import {
  AVATAR_BUCKET,
  AVATAR_MAX_SOURCE_BYTES,
  AVATAR_SIZE,
  CREDENTIAL_BUCKET,
  CREDENTIAL_MAX_BYTES,
  CREDENTIAL_TYPES,
  centeredSquare,
  isExternalLink,
  newObjectName,
} from "@/lib/storage/uploads";

/**
 * Subidas desde el dispositivo (migración 0026). El archivo va directo del navegador a Supabase Storage, con la sesión
 * de la persona: las políticas de la base deciden si puede escribir ahí. El formulario recibe la referencia en un
 * campo oculto y la guarda al apretar «Guardar»; el servidor comprueba que sea un archivo propio y borra los viejos.
 */

type Status = { kind: "idle" } | { kind: "busy" } | { kind: "error"; message: string } | { kind: "done"; message: string };

/** La foto, recortada al centro y achicada a 400 × 400. WebP si el navegador sabe generarlo; si no, JPG. */
async function squareImage(file: File): Promise<{ blob: Blob; extension: "webp" | "jpg" }> {
  const bitmap = await createImageBitmap(file);
  const { x, y, side } = centeredSquare(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("sin canvas");
  context.drawImage(bitmap, x, y, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  bitmap.close();
  const toBlob = (type: string) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.86));
  const webp = await toBlob("image/webp");
  if (webp?.type === "image/webp") return { blob: webp, extension: "webp" };
  const jpg = await toBlob("image/jpeg");
  if (!jpg) throw new Error("sin imagen");
  return { blob: jpg, extension: "jpg" };
}

function StatusLine({ status, className }: { status: Status; className: string }) {
  if (status.kind === "idle") return null;
  return (
    <p className={`${className} ${status.kind === "error" ? "is-error" : ""}`} role={status.kind === "error" ? "alert" : "status"}>
      {status.kind === "busy" ? "Subiendo…" : status.message}
    </p>
  );
}

export function AvatarUpload({
  userId,
  name,
  value,
  onChange,
  inputName = "avatarUrl",
}: {
  userId: string;
  /** Para las iniciales mientras no haya foto. */
  name: string;
  /** Dirección de la foto actual, o "". */
  value: string;
  onChange: (url: string) => void;
  inputName?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setStatus({ kind: "error", message: "Elegí una imagen (JPG, PNG o WebP)." });
      return;
    }
    if (file.size > AVATAR_MAX_SOURCE_BYTES) {
      setStatus({ kind: "error", message: "Esa imagen es muy pesada. Elegí una de hasta 15 MB." });
      return;
    }
    setStatus({ kind: "busy" });
    let image;
    try {
      image = await squareImage(file);
    } catch {
      setStatus({ kind: "error", message: "No pudimos abrir esa imagen. Probá con una JPG o PNG." });
      return;
    }
    const supabase = createClient();
    const objectName = newObjectName(userId, image.extension);
    const { error } = await supabase.storage.from(AVATAR_BUCKET).upload(objectName, image.blob, {
      contentType: image.blob.type,
      cacheControl: "31536000",
      upsert: false,
    });
    if (error) {
      setStatus({ kind: "error", message: "No pudimos subir la foto. Probá de nuevo en un momento." });
      return;
    }
    onChange(supabase.storage.from(AVATAR_BUCKET).getPublicUrl(objectName).data.publicUrl);
    setStatus({ kind: "done", message: "Lista. Se guarda al apretar «Guardar»." });
  }

  return (
    <div className="file-upload file-upload-avatar">
      {/* La clave fuerza a mostrar la foto nueva aunque la anterior no haya cargado. */}
      <Avatar key={value} name={name || "Tu foto"} src={value || undefined} size={88} />
      <div>
        <div className="file-upload-actions">
          <button type="button" className="file-upload-button" onClick={() => input.current?.click()} disabled={status.kind === "busy"}>
            <Icon name="upload" size={17} /> {value ? "Cambiar foto" : "Subir foto"}
          </button>
          {value && (
            <button
              type="button"
              className="file-upload-remove"
              onClick={() => {
                onChange("");
                setStatus({ kind: "done", message: "Se quita al apretar «Guardar»." });
              }}
              disabled={status.kind === "busy"}
            >
              Quitar
            </button>
          )}
        </div>
        <p className="file-upload-hint">JPG, PNG o WebP. La recortamos cuadrada, centrada.</p>
        <StatusLine status={status} className="file-upload-status" />
      </div>
      <input ref={input} type="file" accept="image/*" hidden onChange={choose} aria-label="Elegir una foto de perfil" />
      <input type="hidden" name={inputName} value={value} />
    </div>
  );
}

export function CredentialUpload({
  userId,
  value,
  viewUrl,
  onChange,
  inputName = "credentialUrl",
}: {
  userId: string;
  /** Nombre del archivo en la carpeta privada, un enlace de antes de la 0026, o "". */
  value: string;
  /** Enlace firmado para ver el respaldo ya guardado (lo arma el servidor), o `null`. */
  viewUrl: string | null;
  onChange: (value: string) => void;
  inputName?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [chosenName, setChosenName] = useState<string | null>(null);

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const extension = CREDENTIAL_TYPES[file.type];
    if (!extension) {
      setStatus({ kind: "error", message: "Elegí un PDF o una imagen (JPG, PNG o WebP)." });
      return;
    }
    if (file.size > CREDENTIAL_MAX_BYTES) {
      setStatus({ kind: "error", message: "El archivo pesa más de 5 MB. Probá con uno más liviano." });
      return;
    }
    setStatus({ kind: "busy" });
    const objectName = newObjectName(userId, extension);
    const { error } = await createClient()
      .storage.from(CREDENTIAL_BUCKET)
      .upload(objectName, file, { contentType: file.type, upsert: false });
    if (error) {
      setStatus({ kind: "error", message: "No pudimos subir el archivo. Probá de nuevo en un momento." });
      return;
    }
    setChosenName(file.name);
    onChange(objectName);
    setStatus({ kind: "done", message: "Listo. Se guarda al apretar «Guardar»." });
  }

  const saved = value && !chosenName;
  return (
    <div className="file-upload">
      <div className="file-upload-file">
        <Icon name={value ? "check" : "upload"} size={18} />
        <span>
          {chosenName ? (
            chosenName
          ) : saved && isExternalLink(value) ? (
            <a href={value} target="_blank" rel="noopener noreferrer">
              Tu enlace de respaldo ↗
            </a>
          ) : saved && viewUrl ? (
            <a href={viewUrl} target="_blank" rel="noopener noreferrer">
              Ver el respaldo que subiste ↗
            </a>
          ) : saved ? (
            "Ya subiste un respaldo."
          ) : (
            "Todavía no subiste un respaldo."
          )}
        </span>
      </div>
      <div className="file-upload-actions">
        <button type="button" className="file-upload-button" onClick={() => input.current?.click()} disabled={status.kind === "busy"}>
          <Icon name="upload" size={17} /> {value ? "Reemplazar archivo" : "Subir archivo"}
        </button>
        {value && (
          <button
            type="button"
            className="file-upload-remove"
            onClick={() => {
              setChosenName(null);
              onChange("");
              setStatus({ kind: "done", message: "Se quita al apretar «Guardar»." });
            }}
            disabled={status.kind === "busy"}
          >
            Quitar
          </button>
        )}
      </div>
      <p className="file-upload-hint">PDF o imagen, hasta 5 MB. Lo ve solo el equipo de EstudiApp.</p>
      <StatusLine status={status} className="file-upload-status" />
      <input
        ref={input}
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp"
        hidden
        onChange={choose}
        aria-label="Elegir el archivo de respaldo"
      />
      <input type="hidden" name={inputName} value={value} />
    </div>
  );
}
