"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { FieldError } from "./field-error";
import { Icon } from "./ui";

type AuthRole = "learner" | "teacher";

/** Marco de las pantallas de acceso: historia a la izquierda, formulario a la derecha. */
export function AuthFrame({
  role = "learner",
  children,
}: {
  role?: AuthRole;
  children: ReactNode;
}) {
  return (
    <section className="pub-auth pub-container">
      <aside className="pub-auth-story">
        <p className="pub-eyebrow">UN ESPACIO PARA CRECER</p>
        <h2>
          {role === "teacher" ? (
            <>
              Lo que sabés.
              <br />
              Todo lo que
              <br />
              podés <em>abrir.</em>
            </>
          ) : (
            <>
              Las dudas
              <br />
              se achican.
              <br />
              Vos <em>crecés.</em>
            </>
          )}
        </h2>
        <div className="pub-auth-art" aria-hidden="true">
          <div className="pub-auth-grid" />
          <span className="pub-auth-formula">a² + b² = c²</span>
          <span className="pub-auth-asterisk">✳</span>
          <svg viewBox="0 0 220 160">
            <path
              d="M32 134V27m-8 15 8-15 9 13M27 129h170m-14-8 14 8-13 9M47 110c29-3 40-5 64-31s40-18 61-53"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="111" cy="79" r="7" fill="var(--orange)" />
          </svg>
          <span className="pub-auth-scribble">paso a paso ↗</span>
        </div>
        <p>
          {role === "teacher"
            ? "Compartí tu experiencia. Acompañá el próximo paso de alguien."
            : "Un buen acompañamiento cambia la forma de aprender. Encontrá el tuyo."}
        </p>
        <span className="pub-auth-footer">CONOCIMIENTO QUE CONECTA.</span>
      </aside>
      <div className="pub-auth-form-wrap">{children}</div>
    </section>
  );
}

/** Encabezado común: sobretítulo, título y bajada. */
export function AuthHeading({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <>
      <p className="pub-eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      {subtitle && <p className="pub-auth-subtitle">{subtitle}</p>}
    </>
  );
}

/** Selector entre cuenta de estudiante y de docente (navega entre rutas). */
export function AuthRoleLinks({
  current,
  labels,
}: {
  current: AuthRole;
  labels: [learner: string, teacher: string];
}) {
  return (
    <nav className="pub-role-tabs pub-auth-roles" aria-label="Tipo de cuenta">
      <Link
        href="/registro/alumno"
        aria-current={current === "learner" ? "page" : undefined}
      >
        <Icon name="book" size={17} />
        {labels[0]}
      </Link>
      <Link
        href="/registro/docente"
        aria-current={current === "teacher" ? "page" : undefined}
      >
        <Icon name="graduation" size={18} />
        {labels[1]}
      </Link>
    </nav>
  );
}

export function FormError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p className="pub-form-error" id={id} role="alert">
      {children}
    </p>
  );
}

export function TextField({
  label,
  name,
  type = "text",
  autoComplete,
  placeholder,
  errors,
  defaultValue,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
  errors?: string[];
  defaultValue?: string;
}) {
  const errorId = `${name}-error`;
  return (
    <label>
      {label}
      <input
        name={name}
        type={type}
        autoComplete={autoComplete}
        placeholder={placeholder}
        defaultValue={defaultValue}
        required
        aria-invalid={errors?.length ? true : undefined}
        aria-describedby={errors?.length ? errorId : undefined}
      />
      <FieldError id={errorId} messages={errors} />
    </label>
  );
}

export function PasswordField({
  label = "Contraseña",
  name = "password",
  autoComplete,
  placeholder,
  errors,
}: {
  label?: string;
  name?: string;
  autoComplete: "new-password" | "current-password";
  placeholder?: string;
  errors?: string[];
}) {
  const [visible, setVisible] = useState(false);
  const errorId = `${name}-error`;
  return (
    <label>
      {label}
      <div className="pub-password">
        <input
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          placeholder={placeholder}
          required
          aria-invalid={errors?.length ? true : undefined}
          aria-describedby={errors?.length ? errorId : undefined}
        />
        <button
          type="button"
          onClick={() => setVisible(!visible)}
          aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
        >
          <Icon name={visible ? "eye-off" : "eye"} size={19} />
        </button>
      </div>
      <FieldError id={errorId} messages={errors} />
    </label>
  );
}

export function TermsCheck({
  errors,
  defaultChecked,
}: {
  errors?: string[];
  defaultChecked?: boolean;
}) {
  return (
    <>
      <label className="pub-check pub-terms-check">
        <input
          type="checkbox"
          name="terms"
          required
          defaultChecked={defaultChecked}
        />
        <span>
          Acepto los <Link href="/terminos">Términos y condiciones</Link> y la{" "}
          <Link href="/privacidad">Política de privacidad</Link>.
        </span>
      </label>
      <FieldError id="terms-error" messages={errors} />
    </>
  );
}

export function SubmitButton({
  pending,
  idle,
  busy,
}: {
  pending: boolean;
  idle: string;
  busy: string;
}) {
  return (
    <button className="pub-primary-button" type="submit" disabled={pending}>
      {pending ? busy : idle}
      <Icon name="arrow-right" size={18} />
    </button>
  );
}

/** Pantalla de confirmación (éxito) con el mismo lenguaje que el resto del acceso. */
export function AuthSuccess({
  eyebrow,
  title,
  children,
  action,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="pub-auth-success" role="status">
      <span className="pub-success-mark">
        <Icon name="check" size={30} />
      </span>
      <p className="pub-eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p>{children}</p>
      {action}
    </div>
  );
}
