// MOCK — funciones de lectura/escritura sobre los arrays de data.ts.
// Reemplazan a las consultas de Supabase mientras no hay base de datos.

import {
  AVAILABILITY_SLOTS,
  BOOKINGS,
  PROFILES,
  RATINGS,
  SUBJECTS,
  TUTOR_PROFILES,
  TUTOR_SUBJECTS,
  type BookingStatus,
  type Profile,
  type VerificationStatus,
} from "./data";

// --- Perfiles ---------------------------------------------------------

export function getProfile(id: string): Profile | null {
  return PROFILES.find((p) => p.id === id) ?? null;
}

export function findProfileByEmail(email: string): Profile | null {
  return PROFILES.find((p) => p.email === email) ?? null;
}

export function updateProfile(
  id: string,
  data: { full_name: string; avatar_url: string | null },
) {
  const profile = PROFILES.find((p) => p.id === id);
  if (!profile) return;
  profile.full_name = data.full_name;
  profile.avatar_url = data.avatar_url;
}

export function createProfile(input: {
  email: string;
  password: string;
  fullName: string;
  role: "alumno" | "docente";
}): Profile {
  const id = `user-${crypto.randomUUID()}`;
  const profile: Profile = {
    id,
    email: input.email,
    password: input.password,
    role: input.role,
    full_name: input.fullName,
    avatar_url: null,
  };
  PROFILES.push(profile);

  if (input.role === "docente") {
    TUTOR_PROFILES.push({
      id,
      bio: "",
      nivel_academico: null,
      credential_url: null,
      tarifa_por_clase: 0,
      contacto_verificacion: null,
      verification_status: "pendiente",
      verification_reason: null,
      rating_promedio: 0,
      created_at: new Date().toISOString(),
    });
  }

  return profile;
}

// --- Docentes: perfil, catálogo, moderación ------------------------------

function tutorSubjectNames(tutorId: string) {
  return TUTOR_SUBJECTS.filter((ts) => ts.tutor_id === tutorId)
    .map((ts) => SUBJECTS.find((s) => s.id === ts.subject_id)?.name)
    .filter((name): name is string => Boolean(name));
}

function tutorHasAvailability(tutorId: string) {
  const now = Date.now();
  return AVAILABILITY_SLOTS.some(
    (slot) => slot.tutor_id === tutorId && !slot.is_booked && new Date(slot.starts_at).getTime() > now,
  );
}

export function getTutorProfile(id: string) {
  return TUTOR_PROFILES.find((tp) => tp.id === id) ?? null;
}

export function listTutorsByStatus(status: VerificationStatus) {
  return TUTOR_PROFILES.filter((tp) => tp.verification_status === status).map((tp) => ({
    id: tp.id,
    verification_status: tp.verification_status,
    created_at: tp.created_at,
    profiles: { full_name: getProfile(tp.id)?.full_name ?? "Docente" },
  }));
}

export function getTutorDetail(id: string) {
  const tp = TUTOR_PROFILES.find((t) => t.id === id);
  if (!tp) return null;
  const profile = getProfile(id);
  return {
    id: tp.id,
    bio: tp.bio,
    nivel_academico: tp.nivel_academico,
    credential_url: tp.credential_url,
    tarifa_por_clase: tp.tarifa_por_clase,
    contacto_verificacion: tp.contacto_verificacion,
    verification_status: tp.verification_status,
    verification_reason: tp.verification_reason,
    profiles: profile
      ? { full_name: profile.full_name, avatar_url: profile.avatar_url }
      : null,
    tutor_subjects: tutorSubjectNames(id).map((name) => ({ subjects: { name } })),
  };
}

export function getPublicTutorProfile(id: string) {
  const tp = TUTOR_PROFILES.find((t) => t.id === id && t.verification_status === "aprobado");
  if (!tp) return null;
  const profile = getProfile(id);
  return {
    bio: tp.bio,
    tarifa_por_clase: tp.tarifa_por_clase,
    rating_promedio: tp.rating_promedio,
    profiles: profile
      ? { full_name: profile.full_name, avatar_url: profile.avatar_url }
      : null,
    tutor_subjects: tutorSubjectNames(id).map((name) => ({ subjects: { name } })),
  };
}

export function listRatingsForTutor(tutorId: string) {
  return RATINGS.filter((r) => r.tutor_id === tutorId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((r) => ({ score: r.score, comment: r.comment, created_at: r.created_at }));
}

export function approveTutor(tutorId: string) {
  const tp = TUTOR_PROFILES.find((t) => t.id === tutorId);
  if (!tp) return;
  tp.verification_status = "aprobado";
  tp.verification_reason = null;
  if (tp.rating_promedio === 0) tp.rating_promedio = 0;
}

export function rejectTutor(tutorId: string, reason: string) {
  const tp = TUTOR_PROFILES.find((t) => t.id === tutorId);
  if (!tp) return;
  tp.verification_status = "rechazado";
  tp.verification_reason = reason;
}

export function updateTutorProfile(
  id: string,
  data: {
    fullName: string;
    avatarUrl: string | null;
    bio: string;
    nivelAcademico: string;
    credentialUrl: string | null;
    tarifaPorClase: number;
    contactoVerificacion: string;
    subjectIds: string[];
  },
) {
  updateProfile(id, { full_name: data.fullName, avatar_url: data.avatarUrl });

  const tp = TUTOR_PROFILES.find((t) => t.id === id);
  if (tp) {
    tp.bio = data.bio;
    tp.nivel_academico = data.nivelAcademico;
    tp.credential_url = data.credentialUrl;
    tp.tarifa_por_clase = data.tarifaPorClase;
    tp.contacto_verificacion = data.contactoVerificacion;
  }

  for (let i = TUTOR_SUBJECTS.length - 1; i >= 0; i--) {
    if (TUTOR_SUBJECTS[i].tutor_id === id) TUTOR_SUBJECTS.splice(i, 1);
  }
  for (const subjectId of data.subjectIds) {
    TUTOR_SUBJECTS.push({ tutor_id: id, subject_id: subjectId });
  }
}

// --- Catálogo / búsqueda ---------------------------------------------

export type CatalogFilters = {
  q?: string;
  materia?: string;
  precioMin?: number;
  precioMax?: number;
  disponibilidad?: boolean;
};

export function searchTutorCatalog(filters: CatalogFilters) {
  return TUTOR_PROFILES.filter((tp) => tp.verification_status === "aprobado")
    .map((tp) => {
      const profile = getProfile(tp.id);
      const subjectNames = tutorSubjectNames(tp.id);
      return {
        id: tp.id,
        full_name: profile?.full_name ?? "Docente",
        avatar_url: profile?.avatar_url ?? null,
        bio: tp.bio,
        tarifa_por_clase: tp.tarifa_por_clase,
        rating_promedio: tp.rating_promedio,
        subject_names: subjectNames,
        has_availability: tutorHasAvailability(tp.id),
        search_text: `${profile?.full_name ?? ""} ${subjectNames.join(" ")}`.toLowerCase(),
      };
    })
    .filter((row) => (filters.q ? row.search_text.includes(filters.q.toLowerCase()) : true))
    .filter((row) => (filters.materia ? row.subject_names.includes(filters.materia) : true))
    .filter((row) => (filters.precioMin != null ? row.tarifa_por_clase >= filters.precioMin : true))
    .filter((row) => (filters.precioMax != null ? row.tarifa_por_clase <= filters.precioMax : true))
    .filter((row) => (filters.disponibilidad ? row.has_availability : true))
    .sort((a, b) => b.rating_promedio - a.rating_promedio);
}

// --- Reservas del alumno --------------------------------------------

export type StudentBookingRow = {
  id: string;
  status: BookingStatus;
  availability_slots: { starts_at: string; ends_at: string } | null;
  tutor_profiles: { profiles: { full_name: string } | null } | null;
};

function studentBookingRows(studentId: string, status: BookingStatus) {
  return BOOKINGS.filter((b) => b.student_id === studentId && b.status === status).map((b) => {
    const slot = AVAILABILITY_SLOTS.find((s) => s.id === b.slot_id) ?? null;
    const tutorProfile = getProfile(b.tutor_id);
    return {
      row: {
        id: b.id,
        status: b.status,
        availability_slots: slot ? { starts_at: slot.starts_at, ends_at: slot.ends_at } : null,
        tutor_profiles: { profiles: tutorProfile ? { full_name: tutorProfile.full_name } : null },
      } satisfies StudentBookingRow,
      startsAt: slot?.starts_at ?? "",
    };
  });
}

export function getUpcomingBookings(studentId: string): StudentBookingRow[] {
  return studentBookingRows(studentId, "confirmada")
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .map(({ row }) => row);
}

export function getCompletedBookings(studentId: string): StudentBookingRow[] {
  return studentBookingRows(studentId, "completada")
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
    .map(({ row }) => row);
}

// --- Métricas del admin -----------------------------------------------

export function countProfiles() {
  return PROFILES.length;
}

export function countTutorsByStatus(status: VerificationStatus) {
  return TUTOR_PROFILES.filter((tp) => tp.verification_status === status).length;
}

export function countBookings() {
  return BOOKINGS.length;
}

// --- Materias ---------------------------------------------------------

export function listSubjects() {
  return [...SUBJECTS].sort((a, b) => a.name.localeCompare(b.name));
}
