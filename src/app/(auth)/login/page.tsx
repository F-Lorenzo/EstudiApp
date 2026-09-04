"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FieldError } from "@/components/field-error";
import { initialActionState } from "@/lib/validation/form-state";
import { login } from "./actions";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, initialActionState);

  return (
    <form action={formAction} className="space-y-4">
      <h1 className="text-xl font-semibold">Iniciar sesión</h1>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}

      <div>
        <label htmlFor="email" className="block text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          className="mt-1 w-full border-2 border-black px-3 py-2"
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
          className="mt-1 w-full border-2 border-black px-3 py-2"
        />
        <FieldError messages={state.fieldErrors?.password} />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full border-2 border-black bg-white px-3 py-2 text-black hover:bg-black hover:text-white disabled:opacity-50"
      >
        {pending ? "Ingresando..." : "Ingresar"}
      </button>

      <div className="flex justify-between text-sm">
        <Link href="/recuperar-password">Olvidé mi contraseña</Link>
        <Link href="/registro/alumno">Crear cuenta</Link>
      </div>
    </form>
  );
}
