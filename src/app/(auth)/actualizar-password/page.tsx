"use client";

import { useActionState } from "react";
import {
  AuthFrame,
  AuthHeading,
  FormError,
  PasswordField,
  SubmitButton,
} from "@/components/auth-ui";
import { initialActionState } from "@/lib/validation/form-state";
import { updatePassword } from "./actions";

export default function ActualizarPasswordPage() {
  const [state, formAction, pending] = useActionState(
    updatePassword,
    initialActionState,
  );

  return (
    <AuthFrame>
      <AuthHeading
        eyebrow="UN NUEVO COMIENZO"
        title="Creá tu nueva contraseña."
        subtitle="Elegí una que puedas recordar. Después vas a ingresar con ella."
      />
      <form className="pub-form" action={formAction}>
        {state.error && <FormError id="update-error">{state.error}</FormError>}
        <PasswordField
          label="Nueva contraseña"
          autoComplete="new-password"
          placeholder="Al menos 8 caracteres"
          errors={state.fieldErrors?.password}
        />
        <PasswordField
          label="Repetí la contraseña"
          name="confirmPassword"
          autoComplete="new-password"
          placeholder="Escribila de nuevo"
          errors={state.fieldErrors?.confirmPassword}
        />
        <SubmitButton
          pending={pending}
          idle="Guardar contraseña"
          busy="Guardando…"
        />
      </form>
    </AuthFrame>
  );
}
