import { createClient } from "@/lib/supabase/server";

async function count(
  supabase: Awaited<ReturnType<typeof createClient>>,
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

  const [usuarios, docentesAprobados, docentesPendientes, reservas] =
    await Promise.all([
      count(supabase, "profiles"),
      count(supabase, "tutor_profiles", { verification_status: "aprobado" }),
      count(supabase, "tutor_profiles", { verification_status: "pendiente" }),
      count(supabase, "bookings"),
    ]);

  const metrics = [
    { label: "Usuarios suscriptos", value: usuarios },
    { label: "Docentes aprobados", value: docentesAprobados },
    { label: "Docentes pendientes", value: docentesPendientes },
    { label: "Clases reservadas", value: reservas },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Métricas generales</h1>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {metrics.map((metric) => (
          <div key={metric.label} className="border-2 border-black p-4">
            <p className="text-2xl font-semibold">{metric.value}</p>
            <p className="text-sm text-neutral-600">{metric.label}</p>
          </div>
        ))}
      </div>

      <p className="text-sm text-neutral-600">
        &quot;Usuarios logueados / activos&quot; no está disponible todavía:
        requiere consultar <code>auth.users</code> con la service role key,
        que no usamos desde el cliente por seguridad.
      </p>
    </div>
  );
}
