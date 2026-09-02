import type { SupabaseClient } from "@supabase/supabase-js";

export type TutorListRow = {
  id: string;
  verification_status: string;
  created_at: string;
  profiles: { full_name: string } | null;
};

export async function listTutorsByStatus(
  supabase: SupabaseClient,
  status: "pendiente" | "aprobado" | "rechazado",
) {
  return supabase
    .from("tutor_profiles")
    .select("id, verification_status, created_at, profiles(full_name)")
    .eq("verification_status", status)
    .order("created_at")
    .returns<TutorListRow[]>();
}

export type TutorDetail = {
  id: string;
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
      "id, bio, nivel_academico, credential_url, tarifa_por_clase, contacto_verificacion, verification_status, verification_reason, profiles(full_name, avatar_url), tutor_subjects(subjects(name))",
    )
    .eq("id", tutorId)
    .single<TutorDetail>();
}
