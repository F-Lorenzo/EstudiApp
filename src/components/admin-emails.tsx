"use client";

import { useActionState } from "react";
import { sendTestEmail } from "@/app/admin/emails/actions";
import { Badge, PageHeading } from "@/components/ui";
import type { EmailSetup } from "@/lib/admin/email-status";
import { initialActionState } from "@/lib/validation/form-state";
import { TableWrap } from "@/components/management-ui";

export type EmailProblemRow = { key: string; kind: string; status: "fallido" | "omitido"; error: string; when: string };

export type EmailStatusView = {
  setup: EmailSetup;
  /** `null`: no se pudo leer la bandeja. */
  outbox: {
    sent: number;
    pending: number;
    failed: number;
    skipped: number;
    waiting: number;
    oldestWaiting: string | null;
    lastSent: string | null;
    problems: EmailProblemRow[];
  } | null;
};

const number = (value: number) => value.toLocaleString("es-AR");

export function EmailStatus({ setup, outbox }: EmailStatusView) {
  const rows: { label: string; ok: boolean; value: string; hint?: string }[] = [
    {
      label: "Clave de Resend (RESEND_API_KEY)",
      ok: setup.apiKey,
      value: setup.apiKey ? "Cargada" : "Falta",
      hint: setup.apiKey ? undefined : "Va como secreto del Worker en Cloudflare.",
    },
    {
      label: "Remitente (EMAIL_FROM)",
      ok: setup.fromValid,
      value: setup.from ?? "Falta",
      hint: setup.from && !setup.fromValid ? "No tiene el formato «EstudiApp <avisos@mail.estudiapp.app>»." : undefined,
    },
    {
      label: "Responder a (EMAIL_REPLY_TO)",
      ok: setup.replyToValid,
      value: setup.replyTo ?? "Sin configurar",
      hint: !setup.replyToValid
        ? "Tiene que ser una sola dirección de email."
        : setup.replyTo
          ? undefined
          : "Es opcional, pero sin ella las respuestas de la gente se pierden.",
    },
    {
      label: "Clave de servicio de Supabase",
      ok: setup.serviceRole,
      value: setup.serviceRole ? "Cargada" : "Falta",
      hint: setup.serviceRole ? undefined : "Sin ella el servidor no lee la bandeja.",
    },
    {
      label: "Dirección del sitio (NEXT_PUBLIC_SITE_URL)",
      ok: setup.siteUrl !== null,
      value: setup.siteUrl ?? "Falta",
      hint: setup.siteUrl ? undefined : "Los emails salen sin botones.",
    },
  ];

  return (
    <div className="mgmt-page">
      <PageHeading
        eyebrow="EMAILS"
        title="Avisos que llegan."
        description="La configuración del envío con Resend y cómo viene la bandeja: lo que salió, lo que espera y lo que tuvo problemas. Un email que no sale en 48 horas vence y no se manda."
      >
        <Badge tone={setup.ready ? "green" : "orange"}>{setup.ready ? "Enviando" : "Sin configurar"}</Badge>
      </PageHeading>

      <div className="mgmt-commission-layout">
        {/* Como en Comisión: el formulario en la columna angosta y la tabla en la ancha. */}
        <TestEmailForm ready={setup.ready} />
        <section className="mgmt-panel">
          <div className="mgmt-section-heading">
            <div>
              <h2>Configuración</h2>
              <p>Se carga en Cloudflare (Workers → estudiapp → Settings → Variables and Secrets). La clave nunca se muestra.</p>
            </div>
          </div>
          <dl className="mgmt-email-setup">
            {rows.map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd>
                  <Badge tone={row.ok ? "green" : "orange"}>{row.ok ? "OK" : "Revisar"}</Badge> <span>{row.value}</span>
                  {row.hint && <small>{row.hint}</small>}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      {outbox ? (
        <>
          <div className="mgmt-metric-strip mgmt-email-strip">
            <article>
              <span>Enviados</span>
              <strong>{number(outbox.sent)}</strong>
              <p>en los últimos 7 días{outbox.lastSent ? `; el último, ${outbox.lastSent}` : ""}</p>
            </article>
            <article>
              <span>Esperando</span>
              <strong>{number(outbox.waiting)}</strong>
              <p>{outbox.oldestWaiting ? `el más viejo, ${outbox.oldestWaiting}` : "nada por salir"}</p>
            </article>
            <article>
              <span>Con fallas</span>
              <strong>{number(outbox.failed)}</strong>
              <p>se reintentan solos, hasta 5 veces (7 días)</p>
            </article>
            <article>
              <span>Descartados</span>
              <strong>{number(outbox.skipped)}</strong>
              <p>vencidos, de clases canceladas o sin destinatario (7 días)</p>
            </article>
          </div>
          <section className="mgmt-panel mgmt-commission-preview">
            <div className="mgmt-section-heading">
              <div>
                <h2>Últimos problemas</h2>
                <p>Los emails que fallaron o se descartaron, con el motivo. No se muestra a quién iban.</p>
              </div>
            </div>
            {outbox.problems.length ? (
              <TableWrap label="Últimos problemas">
                <table className="mgmt-table">
                  <thead>
                    <tr>
                      <th>Email</th>
                      <th>Estado</th>
                      <th>Motivo</th>
                      <th>Cuándo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {outbox.problems.map((problem) => (
                      <tr key={problem.key}>
                        <td>{problem.kind}</td>
                        <td>
                          <Badge tone={problem.status === "fallido" ? "orange" : "muted"}>
                            {problem.status === "fallido" ? "Falló" : "Descartado"}
                          </Badge>
                        </td>
                        <td>{problem.error}</td>
                        <td>{problem.when}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            ) : (
              <p className="mgmt-field-hint">Ningún problema por ahora.</p>
            )}
          </section>
        </>
      ) : (
        <p className="mgmt-field-error" role="alert">
          No pudimos leer la bandeja de emails. Actualizá la página en un momento.
        </p>
      )}
    </div>
  );
}

function TestEmailForm({ ready }: { ready: boolean }) {
  const [state, formAction, pending] = useActionState(sendTestEmail, initialActionState);
  return (
    <form action={formAction} className="mgmt-panel mgmt-commission-settings">
      <div className="mgmt-section-heading">
        <div>
          <h2>Probar el envío</h2>
          <p>Te manda un email de prueba a tu propia cuenta, con la misma maqueta que los avisos reales.</p>
        </div>
      </div>
      {state.error && (
        <p className="mgmt-field-error" role="alert">
          {state.error}
        </p>
      )}
      {state.success && (
        <p className="mgmt-field-hint" role="status">
          Enviado. Revisá tu bandeja de entrada (y la de spam) en un minuto.
        </p>
      )}
      <button type="submit" className="mgmt-button" disabled={pending || !ready}>
        {pending ? "Enviando…" : "Enviarme un email de prueba"}
      </button>
      {!ready && <p className="mgmt-field-hint">Se habilita cuando la configuración esté completa.</p>}
    </form>
  );
}
