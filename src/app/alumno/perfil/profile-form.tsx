"use client";

import { useActionState, useState } from "react";
import { FieldError } from "@/components/field-error";
import { AvatarUpload } from "@/components/file-uploads";
import { Icon } from "@/components/ui";
import { initialActionState } from "@/lib/validation/form-state";
import { updateProfile } from "./actions";

export function ProfileForm({
  userId,
  email,
  fullName,
  avatarUrl,
}: {
  userId: string;
  email: string;
  fullName: string;
  avatarUrl: string;
}) {
  const [state, formAction, pending] = useActionState(
    updateProfile,
    initialActionState,
  );
  const [name, setName] = useState(fullName);
  const [photo, setPhoto] = useState(avatarUrl);

  return (
    <form action={formAction} className="stu-profile-form">
      <div className="stu-profile-photo">
        <strong>Tu foto de perfil</strong>
        <p>La ve tu profe cuando reservás una clase. Es opcional.</p>
        <AvatarUpload userId={userId} name={name || "Estudiante"} value={photo} onChange={setPhoto} />
        <FieldError messages={state.fieldErrors?.avatarUrl} />
      </div>
      <div className="stu-profile-fields">
        <label className="stu-field">
          <span>Nombre y apellido</span>
          <input
            name="fullName"
            required
            autoComplete="name"
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-invalid={state.fieldErrors?.fullName ? true : undefined}
          />
          <FieldError messages={state.fieldErrors?.fullName} />
        </label>
        <label className="stu-field">
          <span>Correo electrónico</span>
          <input type="email" value={email} readOnly aria-readonly="true" />
          <small>Es el email con el que ingresás. No se puede cambiar acá.</small>
        </label>
      </div>
      {state.error && (
        <p className="stu-field-error" role="alert">
          {state.error}
        </p>
      )}
      {state.success && (
        <div className="stu-notice" role="status">
          <Icon name="check" size={18} />
          <span>Listo, guardamos tus cambios.</span>
        </div>
      )}
      <div className="stu-form-actions">
        <span />
        <button type="submit" className="stu-button" disabled={pending}>
          {pending ? "Guardando…" : "Guardar cambios"}{" "}
          <Icon name="check" size={18} />
        </button>
      </div>
    </form>
  );
}
