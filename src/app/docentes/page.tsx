import Link from "next/link";
import { searchTutorCatalog } from "@/lib/tutors/catalog";
import { createClient } from "@/lib/supabase/server";

export default async function CatalogoDocentesPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    materia?: string;
    precioMin?: string;
    precioMax?: string;
    disponibilidad?: string;
  }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  const [{ data: tutors }, { data: subjects }] = await Promise.all([
    searchTutorCatalog(supabase, {
      q: params.q,
      materia: params.materia,
      precioMin: params.precioMin ? Number(params.precioMin) : undefined,
      precioMax: params.precioMax ? Number(params.precioMax) : undefined,
      disponibilidad: params.disponibilidad === "on",
    }),
    supabase.from("subjects").select("name").order("name"),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Buscar docentes</h1>

      <form className="flex flex-wrap items-end gap-3 rounded border p-4" method="get">
        <div>
          <label htmlFor="q" className="block text-sm font-medium">
            Buscar
          </label>
          <input
            id="q"
            name="q"
            type="text"
            defaultValue={params.q}
            placeholder="Nombre o materia"
            className="mt-1 rounded border px-3 py-2"
          />
        </div>

        <div>
          <label htmlFor="materia" className="block text-sm font-medium">
            Materia
          </label>
          <select
            id="materia"
            name="materia"
            defaultValue={params.materia ?? ""}
            className="mt-1 rounded border px-3 py-2"
          >
            <option value="">Todas</option>
            {(subjects ?? []).map((subject) => (
              <option key={subject.name} value={subject.name}>
                {subject.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="precioMin" className="block text-sm font-medium">
            Precio mín.
          </label>
          <input
            id="precioMin"
            name="precioMin"
            type="number"
            min="0"
            defaultValue={params.precioMin}
            className="mt-1 w-24 rounded border px-3 py-2"
          />
        </div>

        <div>
          <label htmlFor="precioMax" className="block text-sm font-medium">
            Precio máx.
          </label>
          <input
            id="precioMax"
            name="precioMax"
            type="number"
            min="0"
            defaultValue={params.precioMax}
            className="mt-1 w-24 rounded border px-3 py-2"
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="disponibilidad"
            defaultChecked={params.disponibilidad === "on"}
          />
          Con disponibilidad
        </label>

        <button type="submit" className="rounded bg-black px-4 py-2 text-white">
          Buscar
        </button>
      </form>

      {tutors && tutors.length > 0 ? (
        <ul className="divide-y rounded border">
          {tutors.map((tutor) => (
            <li key={tutor.id} className="flex items-center justify-between p-4">
              <div>
                <Link href={`/docentes/${tutor.id}`} className="font-medium underline">
                  {tutor.full_name}
                </Link>
                <p className="text-sm text-neutral-600">
                  {tutor.subject_names.join(", ") || "Sin materias cargadas"}
                </p>
                <p className="text-sm text-neutral-600">
                  ${tutor.tarifa_por_clase} · {tutor.rating_promedio.toFixed(1)} / 5
                  {tutor.has_availability ? " · con disponibilidad" : ""}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-neutral-600">No encontramos docentes con esos filtros.</p>
      )}
    </div>
  );
}
