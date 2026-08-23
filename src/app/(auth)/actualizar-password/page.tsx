"use client";

import { useActionState } from "react";
import { FieldError } from "@/components/field-error";
import { initialActionState } from "@/lib/validation/form-state";
import { updatePassword } from "./actions";

export default function ActualizarPasswordPage() {
  const [state, formAction, pending] = useActionState(
    updatePassword,
    initialActionState,
  );

  return (
    <form action={formAction} className="space-y-4">
      <h1 className="text-xl font-semibold">Elegí una nueva contraseña</h1>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}

      <div>
        <label htmlFor="password" className="block text-sm font-medium">
          Nueva contraseña
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          className="mt-1 w-full rounded border px-3 py-2"
        />
        <FieldError messages={state.fieldErrors?.password} />
      </div>

      <div>
        <label htmlFor="confirmPassword" className="block text-sm font-medium">
          Confirmar contraseña
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          required
          className="mt-1 w-full rounded border px-3 py-2"
        />
        <FieldError messages={state.fieldErrors?.confirmPassword} />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded bg-black px-3 py-2 text-white disabled:opacity-50"
      >
        {pending ? "Guardando..." : "Guardar contraseña"}
      </button>
    </form>
  );
}
