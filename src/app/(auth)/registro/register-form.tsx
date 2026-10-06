"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  AuthHeading,
  AuthRoleLinks,
  FormError,
  PasswordField,
  SubmitButton,
  TermsCheck,
  TextField,
} from "@/components/auth-ui";
import { initialActionState } from "@/lib/validation/form-state";
import { registerAlumno } from "./alumno/actions";
import { registerDocente } from "./docente/actions";

export function RegisterForm({ role }: { role: "alumno" | "docente" }) {
  const teacher = role === "docente";
  const [state, formAction, pending] = useActionState(
    teacher ? registerDocente : registerAlumno,
    initialActionState,
  );

  return (
    <>
      <AuthHeading
        eyebrow="EMPECEMOS POR CONOCERNOS"
        title="Tu próximo paso."
        subtitle={
          teacher
            ? "Creá tu cuenta y después completá tu perfil profesional para que el equipo lo revise."
            : "Creá tu cuenta y encontrá tu lugar."
        }
      />
      <AuthRoleLinks
        current={teacher ? "teacher" : "learner"}
        labels={["Quiero aprender", "Quiero enseñar"]}
      />
      <form className="pub-form" action={formAction}>
        {state.error && <FormError id="register-error">{state.error}</FormError>}
        <TextField
          label="Nombre y apellido"
          name="fullName"
          autoComplete="name"
          placeholder="Como te gusta que te llamen"
          defaultValue={state.values?.fullName}
          errors={state.fieldErrors?.fullName}
        />
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
        <TermsCheck
          defaultChecked={state.values?.terms === "on"}
          errors={state.fieldErrors?.terms}
        />
        <SubmitButton
          pending={pending}
          idle="Crear mi cuenta"
          busy="Creando tu cuenta…"
        />
      </form>
      <p className="pub-auth-switch">
        ¿Ya tenés una cuenta?
        <Link href="/login">Ingresá</Link>
      </p>
    </>
  );
}
