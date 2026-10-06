import type { TutorCatalogRow } from "./catalog";

/**
 * Forma que consume la interfaz (tarjetas, perfil, reserva). Se arma a partir
 * de las filas de Supabase. Los campos que todavía no existen en la base
 * (años de experiencia, universidad) quedan en `null` y la UI los omite.
 */
export type Teacher = {
  id: string;
  name: string;
  /** Materia principal: la primera alfabéticamente. */
  subject: string;
  subjects: string[];
  /** `tutor_profiles.nivel_academico`. */
  title: string | null;
  experience: number | null;
  university: string | null;
  /** 0 significa «todavía sin calificaciones». */
  rating: number;
  /** Cantidad de reseñas, cuando la consulta la trae. */
  reviews: number | null;
  price: number;
  bio: string;
  photo: string | null;
  hasAvailability: boolean;
};

export function teacherFromCatalogRow(row: TutorCatalogRow): Teacher {
  return {
    id: row.id,
    name: row.full_name || "Docente",
    subject: row.subject_names[0] ?? "Sin materia cargada",
    subjects: row.subject_names,
    title: null,
    experience: null,
    university: null,
    rating: Number(row.rating_promedio) || 0,
    reviews: null,
    price: Number(row.tarifa_por_clase) || 0,
    bio: row.bio,
    photo: row.avatar_url,
    hasAvailability: row.has_availability,
  };
}
