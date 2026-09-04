import { notFound } from "next/navigation";
import { getPublicTutorProfile, listRatingsForTutor } from "@/lib/mock/queries";

// El helper solo devuelve perfiles con verification_status = 'aprobado',
// así que un docente no aprobado o inexistente simplemente no aparece acá.
export default async function PerfilPublicoDocentePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tutorProfile = getPublicTutorProfile(id);

  if (!tutorProfile) {
    notFound();
  }

  const ratings = listRatingsForTutor(id);

  const subjectNames = (tutorProfile.tutor_subjects ?? [])
    .map((row) => row.subjects?.name)
    .filter((name): name is string => Boolean(name));

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">
          {tutorProfile.profiles?.full_name ?? "Docente"}
        </h1>
        <p className="text-sm text-neutral-600">
          Calificación promedio: {tutorProfile.rating_promedio.toFixed(1)} / 5
        </p>
      </div>

      <p>{tutorProfile.bio}</p>

      {subjectNames.length > 0 && (
        <div>
          <h2 className="font-medium">Materias</h2>
          <p className="text-sm text-neutral-600">{subjectNames.join(", ")}</p>
        </div>
      )}

      <p className="font-medium">
        Tarifa por clase: ${tutorProfile.tarifa_por_clase}
      </p>

      <div>
        <h2 className="font-medium">Reseñas</h2>
        {ratings.length > 0 ? (
          <ul className="mt-2 space-y-3">
            {ratings.map((rating, index) => (
              <li key={index} className="border-2 border-black p-3 text-sm">
                <p className="font-medium">{rating.score} / 5</p>
                {rating.comment && <p className="text-neutral-600">{rating.comment}</p>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-neutral-600">Todavía no tiene reseñas.</p>
        )}
      </div>
    </div>
  );
}
