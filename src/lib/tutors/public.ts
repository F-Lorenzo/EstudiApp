import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Teacher } from "./view";

type PublicTutorRow = {
  nivel_academico: string | null;
  bio: string;
  tarifa_por_clase: number;
  rating_promedio: number;
  profiles: { full_name: string; avatar_url: string | null } | null;
  tutor_subjects: { subjects: { name: string } | null }[];
};

/**
 * Perfil público de un docente. La RLS de `tutor_profiles` solo deja leer los
 * perfiles aprobados (o el propio / administración), así que un docente no
 * aprobado o inexistente devuelve `null`. Acá solo se piden columnas públicas,
 * pero la RLS es por fila: la API REST de Supabase sigue pudiendo leer las
 * demás columnas de un docente aprobado (ver «Pendiente conocido» en CLAUDE.md).
 * Se memoiza por request para compartirlo entre `generateMetadata` y la página.
 */
export const getPublicTeacher = cache(
  async (id: string): Promise<Teacher | null> => {
    const supabase = await createClient();
    const { data } = await supabase
      .from("tutor_profiles")
      .select(
        "nivel_academico, bio, tarifa_por_clase, rating_promedio, profiles(full_name, avatar_url), tutor_subjects(subjects(name))",
      )
      .eq("id", id)
      .single<PublicTutorRow>();

    if (!data) return null;

    const subjects = (data.tutor_subjects ?? [])
      .map((row) => row.subjects?.name)
      .filter((name): name is string => Boolean(name))
      .sort((a, b) => a.localeCompare(b, "es"));

    return {
      id,
      name: data.profiles?.full_name || "Docente",
      subject: subjects[0] ?? "Sin materia cargada",
      subjects,
      title: data.nivel_academico,
      experience: null,
      university: null,
      rating: Number(data.rating_promedio) || 0,
      reviews: null,
      price: Number(data.tarifa_por_clase) || 0,
      bio: data.bio,
      photo: data.profiles?.avatar_url ?? null,
      hasAvailability: false,
    };
  },
);
