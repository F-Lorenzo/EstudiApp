"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FieldError } from "@/components/field-error";
import { initialActionState } from "@/lib/validation/form-state";
import { registerAlumno } from "./actions";

export default function RegistroAlumnoPage() {
  const [state, formAction, pending] = useActionState(
    registerAlumno,
    initialActionState,
  );

  return (
    <form action={formAction} className="space-y-4">
      <h1 className="text-xl font-semibold">Crear cuenta de alumno</h1>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}

      <div>
        <label htmlFor="fullName" className="block text-sm font-medium">
          Nombre completo
        </label>
        <input
          id="fullName"
          name="fullName"
          type="text"
          required
          className="mt-1 w-full rounded border px-3 py-2"
        />
        <FieldError messages={state.fieldErrors?.fullName} />
      </div>

      <div>
        <label htmlFor="email" className="block text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          className="mt-1 w-full rounded border px-3 py-2"
        />
        <FieldError messages={state.fieldErrors?.email} />
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium">
          Contraseña
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
        {pending ? "Creando cuenta..." : "Crear cuenta"}
      </button>

      <div className="flex justify-between text-sm">
        <Link href="/login">Ya tengo cuenta</Link>
        <Link href="/registro/docente">Soy docente</Link>
      </div>
    </form>
  );
}
