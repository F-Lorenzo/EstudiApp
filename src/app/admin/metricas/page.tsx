import { ButtonLink, PageHeading } from "@/components/ui";
import { relativeFromNow } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Métricas" };

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function count(
  supabase: Supabase,
  table: string,
  match?: Record<string, string>,
) {
  let query = supabase.from(table).select("*", { count: "exact", head: true });
  if (match) {
    for (const [column, value] of Object.entries(match)) {
      query = query.eq(column, value);
    }
  }
  const { count: total } = await query;
  return total ?? 0;
}

export default async function MetricasPage() {
  const supabase = await createClient();

  const [usuarios, aprobados, pendientes, reservas, subjectRows, oldest] =
    await Promise.all([
      count(supabase, "profiles"),
      count(supabase, "tutor_profiles", { verification_status: "aprobado" }),
      count(supabase, "tutor_profiles", { verification_status: "pendiente" }),
      count(supabase, "bookings"),
      supabase
        .from("tutor_subjects")
        .select("subjects(name)")
        .returns<{ subjects: { name: string } | null }[]>(),
      supabase
        .from("tutor_profiles")
        .select("created_at")
        .eq("verification_status", "pendiente")
        .order("created_at")
        .limit(1)
        .returns<{ created_at: string }[]>(),
    ]);

  const metrics = [
    { label: "Usuarios registrados", value: usuarios, note: "cuentas en la plataforma" },
    { label: "Docentes aprobados", value: aprobados, note: "visibles en el catálogo" },
    { label: "Docentes pendientes", value: pendientes, note: "esperan tu revisión" },
    { label: "Clases reservadas", value: reservas, note: "reservas creadas" },
  ];

  // Docentes aprobados por materia.
  const perSubject = new Map<string, number>();
  for (const row of subjectRows.data ?? []) {
    const name = row.subjects?.name;
    if (name) perSubject.set(name, (perSubject.get(name) ?? 0) + 1);
  }
  const ranking = [...perSubject.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "es"))
    .slice(0, 6);
  const top = ranking[0]?.[1] ?? 1;
  const totalAssignments = [...perSubject.values()].reduce((sum, n) => sum + n, 0);
  const oldestDate = oldest.data?.[0]?.created_at;

  return (
    <div className="mgmt-page">
      <PageHeading
        eyebrow="PULSO DE LA COMUNIDAD"
        title="Cada encuentro cuenta."
        description="Una mirada a cómo crece la comunidad y a lo que necesita atención."
      />
      <div className="mgmt-metric-strip">
        {metrics.map((metric) => (
          <article key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value.toLocaleString("es-AR")}</strong>
            <p>{metric.note}</p>
          </article>
        ))}
      </div>
      <div className="mgmt-metrics-grid">
        <section className="mgmt-chart-panel">
          <div className="mgmt-section-heading">
            <div>
              <h2>Las materias con más docentes</h2>
              <p>Docentes aprobados que enseñan cada materia.</p>
            </div>
          </div>
          {ranking.length ? (
            ranking.map(([subject, amount], index) => (
              <div className="mgmt-subject-report-row" key={subject}>
                <span className="mgmt-report-rank">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <strong>{subject}</strong>
                <div className="mgmt-report-track">
                  <span style={{ width: `${(amount / top) * 100}%` }} />
                </div>
                <span>
                  {amount} {amount === 1 ? "docente" : "docentes"}
                </span>
                <b>{Math.round((amount / totalAssignments) * 100)}%</b>
              </div>
            ))
          ) : (
            <p className="mgmt-field-hint">
              Todavía no hay docentes aprobados con materias cargadas.
            </p>
          )}
        </section>
        <aside className="mgmt-attention-panel">
          <span className="mgmt-small-label">PARA MIRAR HOY</span>
          <h2>
            El próximo paso
            <br />
            está de este lado.
          </h2>
          <div className="mgmt-attention-number">
            {String(pendientes).padStart(2, "0")}
            <span>
              {pendientes === 1 ? "perfil espera" : "perfiles esperan"}
              <br />
              tu revisión
            </span>
          </div>
          <p>
            {oldestDate
              ? `La solicitud más antigua se registró ${relativeFromNow(oldestDate)}. Cada revisión abre nuevas posibilidades.`
              : "No hay solicitudes pendientes. Todo al día."}
          </p>
          <ButtonLink href="/admin/docentes/pendientes" variant="secondary">
            Revisar solicitudes ↗
          </ButtonLink>
        </aside>
      </div>
      <p className="mgmt-field-hint">
        Usuarios activos y evolución por período todavía no están disponibles:
        requieren datos que la plataforma aún no registra.
      </p>
    </div>
  );
}
