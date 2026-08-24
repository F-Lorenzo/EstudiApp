"use client";

import { useActionState } from "react";
import { FieldError } from "@/components/field-error";
import { initialActionState } from "@/lib/validation/form-state";
import { updateProfile } from "./actions";

export function ProfileForm({
  email,
  fullName,
  avatarUrl,
}: {
  email: string;
  fullName: string;
  avatarUrl: string;
}) {
  const [state, formAction, pending] = useActionState(
    updateProfile,
    initialActionState,
  );

  return (
    <form action={formAction} className="max-w-sm space-y-4">
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
