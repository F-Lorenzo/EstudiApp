import { ButtonLink, EmptyState, PageHeading } from "@/components/ui";
import { getAdminMetrics, weekLabel } from "@/lib/admin/metrics";
import { moneyExact, relativeFromNow } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Métricas" };

const WEEKS = 8;
const number = (value: number) => value.toLocaleString("es-AR");
const rating = (value: number | null) => (value === null ? "—" : value.toFixed(1).replace(".", ","));

export default async function MetricasPage() {
  const supabase = await createClient();

  // Las cifras de reservas, plata y actividad salen de la base (`admin_metrics`, migración 0020).
  const [{ metrics, error }, subjectRows, oldest] = await Promise.all([
    getAdminMetrics(supabase, { weeks: WEEKS }),
    supabase
      .from("tutor_subjects")
      .select("subjects(name), tutor_profiles!inner(verification_status)")
      .eq("tutor_profiles.verification_status", "aprobado")
      .returns<{ subjects: { name: string } | null }[]>(),
    supabase
      .from("tutor_profiles")
      .select("created_at")
      .eq("verification_status", "pendiente")
      .order("created_at")
      .limit(1)
      .returns<{ created_at: string }[]>(),
  ]);

  if (error || !metrics)
    return (
      <div className="mgmt-page">
        <EmptyState
          title="No pudimos cargar las métricas."
          description="Hubo un problema de nuestro lado. Actualizá la página en un momento."
        />
      </div>
    );

  const month = metrics.last_30_days;
  const activity = [
    { label: "Reservas pagas", value: number(month.paid_bookings), note: "en los últimos 30 días" },
    { label: "Clases dadas", value: number(month.classes_given), note: "en los últimos 30 días" },
    { label: "Ingresos", value: moneyExact(month.revenue), note: "lo que pagaron los alumnos (30 días)" },
    { label: "Comisión", value: moneyExact(month.commission), note: "de EstudiApp, neta de reembolsos (30 días)" },
  ];
  const community = [
    {
      label: "Docentes activos",
      value: number(metrics.tutors.active_30d),
      note: `dieron clases en 30 días, de ${number(metrics.tutors.approved)} aprobados (${number(metrics.tutors.payable)} pueden cobrar)`,
    },
    {
      label: "Alumnos activos",
      value: number(metrics.students.active_30d),
      note: `pagaron una clase en 30 días, de ${number(metrics.students.total)} registrados`,
    },
    {
      label: "Calificación promedio",
      value: rating(metrics.ratings.average),
      note: `${number(metrics.ratings.count)} ${metrics.ratings.count === 1 ? "opinión" : "opiniones"}; ${rating(metrics.ratings.average_30d)} en los últimos 30 días`,
    },
    {
      label: "Cancelaciones",
      value: number(month.paid_cancellations),
      note: `de clases pagas (30 días), ${number(month.tutor_absences)} por ausencia del docente`,
    },
  ];

  const weeks = metrics.weeks;
  const topRevenue = Math.max(1, ...weeks.map((week) => week.revenue));

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
  const pendientes = metrics.tutors.pending;
  const oldestDate = oldest.data?.[0]?.created_at;

  return (
    <div className="mgmt-page">
      <PageHeading
        eyebrow="PULSO DE LA COMUNIDAD"
        title="Cada encuentro cuenta."
        description="Reservas, clases y plata de verdad, con lo que necesita atención."
      />
      <div className="mgmt-metric-strip">
        {activity.map((metric) => (
          <article key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <p>{metric.note}</p>
          </article>
        ))}
      </div>
      <div className="mgmt-metric-strip mgmt-metric-strip-secondary">
        {community.map((metric) => (
          <article key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <p>{metric.note}</p>
          </article>
        ))}
      </div>
      <section className="mgmt-chart-panel mgmt-weeks-panel">
        <div className="mgmt-section-heading">
          <div>
            <h2>Semana a semana</h2>
            <p>
              Las últimas {WEEKS} semanas, de lunes a domingo. Ingresos y reservas por la fecha del pago; clases por el
              día de la clase.
            </p>
          </div>
        </div>
        <div className="mgmt-table-wrap">
          <table className="mgmt-table mgmt-weeks-table">
            <thead>
              <tr>
                <th>Semana del</th>
                <th>Ingresos</th>
                <th>Comisión</th>
                <th>Reservas pagas</th>
                <th>Clases dadas</th>
                <th>Reembolsado</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((week) => (
                <tr key={week.week_start}>
                  <td>{weekLabel(week.week_start)}</td>
                  <td>
                    <div className="mgmt-week-revenue">
                      <span className="mgmt-report-track" aria-hidden="true">
                        <span style={{ width: `${(week.revenue / topRevenue) * 100}%` }} />
                      </span>
                      {moneyExact(week.revenue)}
                    </div>
                  </td>
                  <td>{moneyExact(week.commission)}</td>
                  <td>{number(week.paid_bookings)}</td>
                  <td>{number(week.classes_given)}</td>
                  <td>{week.refunded > 0 ? moneyExact(week.refunded) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mgmt-field-hint">
          En los últimos 30 días se devolvieron {moneyExact(month.refunded)} a alumnos y {number(month.expired_holds)}{" "}
          {month.expired_holds === 1 ? "reserva venció" : "reservas vencieron"} sin pagarse. A los docentes les quedaron{" "}
          {moneyExact(month.tutor_amount)}.
        </p>
      </section>
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
    </div>
  );
}
