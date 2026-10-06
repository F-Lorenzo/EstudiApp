"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  AuthFrame,
  AuthHeading,
  AuthSuccess,
  FormError,
  SubmitButton,
  TextField,
} from "@/components/auth-ui";
import { Icon } from "@/components/ui";
import { initialActionState } from "@/lib/validation/form-state";
import { requestPasswordReset } from "./actions";

export default function RecuperarPasswordPage() {
  const [state, formAction, pending] = useActionState(
    requestPasswordReset,
    initialActionState,
  );

  if (state.success) {
    return (
      <AuthFrame>
        <AuthSuccess
          eyebrow="TODO LISTO PARA CONTINUAR"
          title="Revisá tu email."
          action={
            <Link className="pub-text-button" href="/login">
              Volver a ingresar
            </Link>
          }
        >
          Si existe una cuenta con ese email, te enviamos un enlace para crear
          una nueva contraseña.
        </AuthSuccess>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame>
      <Link className="pub-back-link" href="/login">
        <Icon name="arrow-left" size={16} /> Volver a ingresar
      </Link>
      <AuthHeading
        eyebrow="VOLVAMOS A CONECTAR"
        title="¿Olvidaste tu contraseña?"
        subtitle="Dejanos tu email para recuperar el acceso."
      />
      <form className="pub-form" action={formAction}>
        {state.error && <FormError id="recover-error">{state.error}</FormError>}
        <TextField
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="vos@ejemplo.com"
          defaultValue={state.values?.email}
          errors={state.fieldErrors?.email}
        />
        <SubmitButton
          pending={pending}
          idle="Recuperar acceso"
          busy="Enviando…"
        />
      </form>
    </AuthFrame>
  );
}
