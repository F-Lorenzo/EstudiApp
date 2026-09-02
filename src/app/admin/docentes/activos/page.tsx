import Link from "next/link";
import { listTutorsByStatus } from "@/lib/tutors/queries";
import { createClient } from "@/lib/supabase/server";

export default async function DocentesActivosPage() {
  const supabase = await createClient();
  const { data: tutors } = await listTutorsByStatus(supabase, "aprobado");

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Docentes activos</h1>

      {tutors && tutors.length > 0 ? (
        <ul className="divide-y rounded border">
          {tutors.map((tutor) => (
            <li key={tutor.id} className="flex items-center justify-between p-4">
              <span>{tutor.profiles?.full_name ?? "Docente"}</span>
              <Link href={`/admin/docentes/${tutor.id}`} className="text-sm underline">
                Ver perfil
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-neutral-600">Todavía no hay docentes aprobados.</p>
      )}
    </div>
  );
}
