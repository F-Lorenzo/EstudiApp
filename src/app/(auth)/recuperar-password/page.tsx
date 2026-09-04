"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FieldError } from "@/components/field-error";
import { initialActionState } from "@/lib/validation/form-state";
import { requestPasswordReset } from "./actions";

export default function RecuperarPasswordPage() {
  const [state, formAction, pending] = useActionState(
    requestPasswordReset,
    initialActionState,
  );

  if (state.success) {
    return (
      <div className="space-y-2 text-center">
        <h1 className="text-xl font-semibold">Revisá tu email</h1>
        <p className="text-sm text-neutral-600">
          Si existe una cuenta con ese email, te enviamos un enlace para
          restablecer tu contraseña.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <h1 className="text-xl font-semibold">Recuperar contraseña</h1>

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

      <button
        type="submit"
        disabled={pending}
        className="w-full border-2 border-black bg-white px-3 py-2 text-black hover:bg-black hover:text-white disabled:opacity-50"
      >
        {pending ? "Enviando..." : "Enviar enlace"}
      </button>

      <div className="text-sm">
        <Link href="/login">Volver a iniciar sesión</Link>
      </div>
    </form>
  );
}
