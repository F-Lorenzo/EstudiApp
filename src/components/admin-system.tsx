import Link from "next/link";
import { Badge, PageHeading } from "@/components/ui";
import type { CheckStatus, SystemGroup } from "@/lib/admin/system-status";

const TONE: Record<CheckStatus, "green" | "orange" | "muted"> = { ok: "green", revisar: "orange", apagado: "muted" };
const LABEL: Record<CheckStatus, string> = { ok: "OK", revisar: "Revisar", apagado: "Apagado" };

export function SystemStatus({ groups, pending }: { groups: SystemGroup[]; pending: number }) {
  return (
    <div className="mgmt-page">
      <PageHeading
        eyebrow="SISTEMA"
        title="¿Listo para lanzar?"
        description="Lo que está cargado en el servidor y lo que falta, sin mostrar ninguna clave. Las variables se cargan en Cloudflare (Workers → estudiapp → Settings → Variables and Secrets) y se ven acá al recargar."
      >
        <Badge tone={pending ? "orange" : "green"}>
          {pending ? `${pending} para revisar` : "Todo en orden"}
        </Badge>
      </PageHeading>

      <div className="mgmt-system-groups">
        {groups.map((group) => (
          <section className="mgmt-panel" key={group.title}>
            <div className="mgmt-section-heading">
              <div>
                <h2>{group.title}</h2>
                {group.title === "Clases, emails y mantenimiento" && (
                  <p>
                    El detalle de los emails y un envío de prueba están en <Link href="/admin/emails">Emails</Link>.
                  </p>
                )}
              </div>
            </div>
            <dl className="mgmt-email-setup">
              {group.checks.map((check) => (
                <div key={check.label}>
                  <dt>{check.label}</dt>
                  <dd>
                    <Badge tone={TONE[check.status]}>{LABEL[check.status]}</Badge> <span>{check.value}</span>
                    {check.hint && <small>{check.hint}</small>}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
}
