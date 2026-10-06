import type { SupabaseClient } from "@supabase/supabase-js";
import { relativeFromNow } from "@/lib/format";

export type TutorListRow = {
  id: string;
  verification_status: string;
  created_at: string;
  bio: string;
  nivel_academico: string | null;
  tarifa_por_clase: number;
  rating_promedio: number;
  profiles: { full_name: string; avatar_url: string | null } | null;
  tutor_subjects: { subjects: { name: string } | null }[];
};

export async function listTutorsByStatus(
  supabase: SupabaseClient,
  status: "pendiente" | "aprobado" | "rechazado",
) {
  return supabase
    .from("tutor_profiles")
    .select(
      "id, verification_status, created_at, bio, nivel_academico, tarifa_por_clase, rating_promedio, profiles(full_name, avatar_url), tutor_subjects(subjects(name))",
    )
    .eq("verification_status", status)
    .order("created_at")
    .returns<TutorListRow[]>();
}

/** Fila de las listas de administración, lista para el cliente. */
export type AdminTutorRow = {
  id: string;
  name: string;
  photo: string | null;
  subjects: string[];
  title: string | null;
  price: number;
  rating: number;
  /** «hace 2 días», calculado en el servidor. */
  ago: string;
  /** Todavía no cargó presentación o materias: no hay nada que revisar. */
  incomplete: boolean;
};

export function toAdminRow(row: TutorListRow): AdminTutorRow {
  const subjects = (row.tutor_subjects ?? [])
    .map((item) => item.subjects?.name)
    .filter((name): name is string => Boolean(name))
    .sort((a, b) => a.localeCompare(b, "es"));
  return {
    id: row.id,
    name: row.profiles?.full_name || "Docente",
    photo: row.profiles?.avatar_url ?? null,
    subjects,
    title: row.nivel_academico,
    price: Number(row.tarifa_por_clase) || 0,
    rating: Number(row.rating_promedio) || 0,
    ago: relativeFromNow(row.created_at),
    incomplete: !row.bio.trim() || subjects.length === 0,
  };
}

export type TutorDetail = {
  id: string;
  created_at: string;
  bio: string;
  nivel_academico: string | null;
  credential_url: string | null;
  tarifa_por_clase: number;
  contacto_verificacion: string | null;
  verification_status: string;
  verification_reason: string | null;
  profiles: { full_name: string; avatar_url: string | null } | null;
  tutor_subjects: { subjects: { name: string } | null }[];
};

export async function getTutorDetail(supabase: SupabaseClient, tutorId: string) {
  return supabase
    .from("tutor_profiles")
    .select(
      "id, created_at, bio, nivel_academico, credential_url, tarifa_por_clase, contacto_verificacion, verification_status, verification_reason, profiles(full_name, avatar_url), tutor_subjects(subjects(name))",
    )
    .eq("id", tutorId)
    .single<TutorDetail>();
}
