"use client";

import { useActionState } from "react";
import { FieldError } from "@/components/field-error";
import { initialActionState } from "@/lib/validation/form-state";
import { updateTutorProfile } from "./actions";

type Subject = { id: string; name: string };

export function TutorProfileForm({
  email,
  fullName,
  avatarUrl,
  bio,
  nivelAcademico,
  credentialUrl,
  tarifaPorClase,
  contactoVerificacion,
  subjects,
  selectedSubjectIds,
}: {
  email: string;
  fullName: string;
  avatarUrl: string;
  bio: string;
  nivelAcademico: string;
  credentialUrl: string;
  tarifaPorClase: number;
  contactoVerificacion: string;
  subjects: Subject[];
  selectedSubjectIds: string[];
}) {
  const [state, formAction, pending] = useActionState(
    updateTutorProfile,
    initialActionState,
  );

  return (
    <form action={formAction} className="max-w-lg space-y-4">
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.success && (
        <p className="text-sm text-green-700">Cambios guardados.</p>
      )}

      <div>
        <label className="block text-sm font-medium">Email</label>
        <p className="mt-1 text-sm text-neutral-600">{email}</p>
      </div>

      <div>
        <label htmlFor="fullName" className="block text-sm font-medium">
          Nombre completo
        </label>
        <input
          id="fullName"
          name="fullName"
          type="text"
          defaultValue={fullName}
          required
          className="mt-1 w-full rounded border px-3 py-2"
        />
        <FieldError messages={state.fieldErrors?.fullName} />
      </div>

      <div>
        <label htmlFor="avatarUrl" className="block text-sm font-medium">
          Foto de perfil (URL)
        </label>
        <input
          id="avatarUrl"
          name="avatarUrl"
          type="url"
          defaultValue={avatarUrl}
          placeholder="https://..."
          className="mt-1 w-full rounded border px-3 py-2"
        />
        <FieldError messages={state.fieldErrors?.avatarUrl} />
      </div>

      <div>
        <label htmlFor="bio" className="block text-sm font-medium">
          Biografía / presentación
        </label>
        <textarea
          id="bio"
          name="bio"
          defaultValue={bio}
          required
          rows={4}
          className="mt-1 w-full rounded border px-3 py-2"
        />
        <FieldError messages={state.fieldErrors?.bio} />
      </div>

      <fieldset>
        <legend className="block text-sm font-medium">Materias que enseñás</legend>
        <div className="mt-1 grid grid-cols-2 gap-2">
          {subjects.map((subject) => (
            <label key={subject.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="subjectIds"
                value={subject.id}
                defaultChecked={selectedSubjectIds.includes(subject.id)}
              />
              {subject.name}
            </label>
          ))}
        </div>
        <FieldError messages={state.fieldErrors?.subjectIds} />
      </fieldset>

      <div>
        <label htmlFor="nivelAcademico" className="block text-sm font-medium">
          Nivel académico o título
        </label>
        <input
          id="nivelAcademico"
          name="nivelAcademico"
          type="text"
          defaultValue={nivelAcademico}
          required
          className="mt-1 w-full rounded border px-3 py-2"
        />
        <FieldError messages={state.fieldErrors?.nivelAcademico} />
      </div>

      <div>
        <label htmlFor="credentialUrl" className="block text-sm font-medium">
          Adjunto / respaldo (URL, opcional)
        </label>
        <input
          id="credentialUrl"
          name="credentialUrl"
          type="url"
          defaultValue={credentialUrl}
          placeholder="https://..."
          className="mt-1 w-full rounded border px-3 py-2"
        />
        <FieldError messages={state.fieldErrors?.credentialUrl} />
      </div>

      <div>
        <label htmlFor="tarifaPorClase" className="block text-sm font-medium">
          Tarifa por clase
        </label>
        <input
          id="tarifaPorClase"
          name="tarifaPorClase"
          type="number"
          min="0"
          step="0.01"
          defaultValue={tarifaPorClase || ""}
          required
          className="mt-1 w-full rounded border px-3 py-2"
        />
        <FieldError messages={state.fieldErrors?.tarifaPorClase} />
      </div>

      <div>
        <label htmlFor="contactoVerificacion" className="block text-sm font-medium">
          Contacto para verificación
        </label>
        <input
          id="contactoVerificacion"
          name="contactoVerificacion"
          type="text"
          defaultValue={contactoVerificacion}
          required
          className="mt-1 w-full rounded border px-3 py-2"
        />
        <FieldError messages={state.fieldErrors?.contactoVerificacion} />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded bg-black px-3 py-2 text-white disabled:opacity-50"
      >
        {pending ? "Guardando..." : "Guardar cambios"}
      </button>
    </form>
  );
}
