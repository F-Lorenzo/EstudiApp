import { countBookings, countProfiles, countTutorsByStatus } from "@/lib/mock/queries";

export default async function MetricasPage() {
  const metrics = [
    { label: "Usuarios suscriptos", value: countProfiles() },
    { label: "Docentes aprobados", value: countTutorsByStatus("aprobado") },
    { label: "Docentes pendientes", value: countTutorsByStatus("pendiente") },
    { label: "Clases reservadas", value: countBookings() },
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
        &quot;Usuarios logueados / activos&quot; no está disponible en el modo mock
        (no hay sesiones reales de auth para contar).
      </p>
    </div>
  );
}
