import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

type PublicTutorProfile = {
  bio: string;
  tarifa_por_clase: number;
  rating_promedio: number;
  profiles: { full_name: string; avatar_url: string | null } | null;
  tutor_subjects: { subjects: { name: string } | null }[];
};

// La RLS de tutor_profiles solo permite leer perfiles con
// verification_status = 'aprobado' (o al propio docente / admin), así que
// un docente no aprobado o inexistente simplemente no aparece acá.
export default async function PerfilPublicoDocentePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: tutorProfile } = await supabase
    .from("tutor_profiles")
    .select(
      "bio, tarifa_por_clase, rating_promedio, profiles(full_name, avatar_url), tutor_subjects(subjects(name))",
    )
    .eq("id", id)
    .single<PublicTutorProfile>();

  if (!tutorProfile) {
    notFound();
  }

  const { data: ratings } = await supabase
    .from("ratings")
    .select("score, comment, created_at")
    .eq("tutor_id", id)
    .order("created_at", { ascending: false });

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
        {ratings && ratings.length > 0 ? (
          <ul className="mt-2 space-y-3">
            {ratings.map((rating, index) => (
              <li key={index} className="rounded border p-3 text-sm">
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
