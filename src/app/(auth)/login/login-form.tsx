"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  AuthHeading,
  FormError,
  PasswordField,
  SubmitButton,
  TextField,
} from "@/components/auth-ui";
import { initialActionState } from "@/lib/validation/form-state";
import { login } from "./actions";

export function LoginForm({
  notice,
  redirectTo,
}: {
  /** Aviso que llega por la URL (por ejemplo, un enlace de email vencido). */
  notice?: string;
  redirectTo?: string;
}) {
  const [state, formAction, pending] = useActionState(
    login,
    initialActionState,
  );

  return (
    <>
      <AuthHeading
        eyebrow="QUÉ BUENO VERTE"
        title="Hola, de nuevo."
        subtitle="Tus clases, tus profes y tus próximos logros."
      />
      <form className="pub-form" action={formAction}>
        {redirectTo && (
          <input type="hidden" name="redirectTo" value={redirectTo} />
        )}
        {(state.error || notice) && (
          <FormError id="login-error">{state.error ?? notice}</FormError>
        )}
        <TextField
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="vos@ejemplo.com"
          defaultValue={state.values?.email}
          errors={state.fieldErrors?.email}
        />
        <PasswordField
          autoComplete="current-password"
          placeholder="Tu contraseña"
          errors={state.fieldErrors?.password}
        />
        <Link className="pub-forgot" href="/recuperar-password">
          Olvidé mi contraseña
        </Link>
        <SubmitButton pending={pending} idle="Ingresar" busy="Ingresando…" />
      </form>
      <p className="pub-auth-switch">
        ¿Todavía no tenés cuenta?
        <Link href="/registro/alumno">Sumate a EstudiApp</Link>
      </p>
    </>
  );
}
