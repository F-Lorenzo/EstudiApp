// ============================================================================
// MOCK — SIN BASE DE DATOS
// ============================================================================
// Todo lo de este archivo es reemplazable: son arrays en memoria que
// simulan lo que después va a vivir en Supabase. Se resetean cada vez que
// se reinicia el servidor (`npm run dev`). Para volver a la versión con
// Supabase real, hay un commit anterior en git que tiene todo esto
// conectado a la base — alcanza con revertir el commit que introdujo este
// modo mock (buscá "modo mock" en `git log`).
//
// Para EDITAR los datos de la demo: los arrays de acá abajo (PROFILES,
// TUTOR_PROFILES, etc.) son el "contenido" — se pueden cambiar nombres,
// tarifas, materias, etc. libremente.
// ============================================================================

export type Role = "alumno" | "docente" | "administrador";
export type VerificationStatus = "pendiente" | "aprobado" | "rechazado";
export type BookingStatus = "pendiente_pago" | "confirmada" | "completada" | "cancelada";

export type Profile = {
  id: string;
  email: string;
  password: string; // solo para el login mock, texto plano a propósito
  role: Role;
  full_name: string;
  avatar_url: string | null;
};

export type TutorProfile = {
  id: string; // == Profile.id
  bio: string;
  nivel_academico: string | null;
  credential_url: string | null;
  tarifa_por_clase: number;
  contacto_verificacion: string | null;
  verification_status: VerificationStatus;
  verification_reason: string | null;
  rating_promedio: number;
  created_at: string;
};

export type Subject = { id: string; name: string };
export type TutorSubject = { tutor_id: string; subject_id: string };

export type AvailabilitySlot = {
  id: string;
  tutor_id: string;
  starts_at: string;
  ends_at: string;
  is_booked: boolean;
};

export type Booking = {
  id: string;
  student_id: string;
  tutor_id: string;
  slot_id: string;
  status: BookingStatus;
};

export type Rating = {
  id: string;
  booking_id: string;
  student_id: string;
  tutor_id: string;
  score: number;
  comment: string | null;
  created_at: string;
};

// --- Credenciales de demo -------------------------------------------------
// Todas las cuentas mock usan la misma contraseña.
export const MOCK_PASSWORD = "Demo1234!";

function addHours(iso: string, hours: number) {
  return new Date(new Date(iso).getTime() + hours * 60 * 60 * 1000).toISOString();
}

const NOW = new Date().toISOString();

// --- Materias --------------------------------------------------------------

export const SUBJECTS: Subject[] = [
  { id: "sub-matematica", name: "Matemática" },
  { id: "sub-fisica", name: "Física" },
  { id: "sub-quimica", name: "Química" },
  { id: "sub-biologia", name: "Biología" },
  { id: "sub-lengua", name: "Lengua y Literatura" },
  { id: "sub-ingles", name: "Inglés" },
  { id: "sub-historia", name: "Historia" },
  { id: "sub-geografia", name: "Geografía" },
  { id: "sub-programacion", name: "Programación" },
  { id: "sub-contabilidad", name: "Contabilidad" },
];

function subjectId(name: string) {
  return SUBJECTS.find((s) => s.name === name)!.id;
}

// --- Perfiles (alumnos, docentes, admin) -----------------------------------

export const PROFILES: Profile[] = [
  {
    id: "user-maria",
    email: "maria.gonzalez.demo@estudiapp.test",
    password: MOCK_PASSWORD,
    role: "docente",
    full_name: "María González",
    avatar_url: null,
  },
  {
    id: "user-juan",
    email: "juan.perez.demo@estudiapp.test",
    password: MOCK_PASSWORD,
    role: "docente",
    full_name: "Juan Pérez",
    avatar_url: null,
  },
  {
    id: "user-lucia",
    email: "lucia.fernandez.demo@estudiapp.test",
    password: MOCK_PASSWORD,
    role: "docente",
    full_name: "Lucía Fernández",
    avatar_url: null,
  },
  {
    id: "user-pedro",
    email: "pedro.diaz.demo@estudiapp.test",
    password: MOCK_PASSWORD,
    role: "docente",
    full_name: "Pedro Díaz",
    avatar_url: null,
  },
  {
    id: "user-sofia",
    email: "sofia.martinez.demo@estudiapp.test",
    password: MOCK_PASSWORD,
    role: "alumno",
    full_name: "Sofía Martínez",
    avatar_url: null,
  },
  {
    id: "user-tomas",
    email: "tomas.rodriguez.demo@estudiapp.test",
    password: MOCK_PASSWORD,
    role: "alumno",
    full_name: "Tomás Rodríguez",
    avatar_url: null,
  },
  {
    id: "user-admin",
    email: "admin.demo@estudiapp.test",
    password: MOCK_PASSWORD,
    role: "administrador",
    full_name: "Admin Demo",
    avatar_url: null,
  },
];

// --- Perfiles de docente -----------------------------------------------

export const TUTOR_PROFILES: TutorProfile[] = [
  {
    id: "user-maria",
    bio: "Profesora de Matemática y Física con 8 años de experiencia en secundario y preparación de exámenes de ingreso.",
    nivel_academico: "Profesora en Matemática (UBA)",
    credential_url: null,
    tarifa_por_clase: 2500,
    contacto_verificacion: "+54 9 11 5555-0001",
    verification_status: "aprobado",
    verification_reason: null,
    rating_promedio: 4.8,
    created_at: NOW,
  },
  {
    id: "user-juan",
    bio: "Desarrollador de software y docente de programación e inglés técnico.",
    nivel_academico: "Ingeniero en Sistemas (UTN)",
    credential_url: null,
    tarifa_por_clase: 3000,
    contacto_verificacion: "+54 9 11 5555-0002",
    verification_status: "aprobado",
    verification_reason: null,
    rating_promedio: 4.6,
    created_at: NOW,
  },
  {
    id: "user-lucia",
    bio: "Profesora de Lengua e Historia, especializada en comprensión de textos.",
    nivel_academico: "Profesora en Letras (UNLP)",
    credential_url: null,
    tarifa_por_clase: 2000,
    contacto_verificacion: "+54 9 11 5555-0003",
    verification_status: "aprobado",
    verification_reason: null,
    rating_promedio: 4.9,
    created_at: NOW,
  },
  {
    id: "user-pedro",
    bio: "Estudiante avanzado de Contabilidad, doy clases de apoyo a estudiantes de nivel secundario.",
    nivel_academico: "Estudiante avanzado de Contador Público (UBA)",
    credential_url: null,
    tarifa_por_clase: 1800,
    contacto_verificacion: "+54 9 11 5555-0004",
    verification_status: "pendiente",
    verification_reason: null,
    rating_promedio: 0,
    created_at: NOW,
  },
];

export const TUTOR_SUBJECTS: TutorSubject[] = [
  { tutor_id: "user-maria", subject_id: subjectId("Matemática") },
  { tutor_id: "user-maria", subject_id: subjectId("Física") },
  { tutor_id: "user-juan", subject_id: subjectId("Programación") },
  { tutor_id: "user-juan", subject_id: subjectId("Inglés") },
  { tutor_id: "user-lucia", subject_id: subjectId("Lengua y Literatura") },
  { tutor_id: "user-lucia", subject_id: subjectId("Historia") },
  { tutor_id: "user-pedro", subject_id: subjectId("Contabilidad") },
];

// --- Disponibilidad ------------------------------------------------------

export const AVAILABILITY_SLOTS: AvailabilitySlot[] = [
  { id: "slot-1", tutor_id: "user-maria", starts_at: addHours(NOW, 24), ends_at: addHours(NOW, 25), is_booked: false },
  { id: "slot-2", tutor_id: "user-maria", starts_at: addHours(NOW, 48), ends_at: addHours(NOW, 49), is_booked: false },
  { id: "slot-3", tutor_id: "user-juan", starts_at: addHours(NOW, 30), ends_at: addHours(NOW, 31), is_booked: false },
  { id: "slot-4", tutor_id: "user-lucia", starts_at: addHours(NOW, 72), ends_at: addHours(NOW, 73), is_booked: false },
  // clase pasada, ya reservada -> historial del alumno
  { id: "slot-past", tutor_id: "user-maria", starts_at: addHours(NOW, -48), ends_at: addHours(NOW, -47), is_booked: true },
  // clase futura, ya reservada -> "próximas clases" del alumno
  { id: "slot-upcoming", tutor_id: "user-juan", starts_at: addHours(NOW, 50), ends_at: addHours(NOW, 51), is_booked: true },
];

// --- Reservas --------------------------------------------------------------

export const BOOKINGS: Booking[] = [
  {
    id: "booking-1",
    student_id: "user-sofia",
    tutor_id: "user-maria",
    slot_id: "slot-past",
    status: "completada",
  },
  {
    id: "booking-2",
    student_id: "user-tomas",
    tutor_id: "user-juan",
    slot_id: "slot-upcoming",
    status: "confirmada",
  },
];

// --- Reseñas -------------------------------------------------------------

export const RATINGS: Rating[] = [
  {
    id: "rating-1",
    booking_id: "booking-1",
    student_id: "user-sofia",
    tutor_id: "user-maria",
    score: 5,
    comment: "Excelente clase, explica muy claro.",
    created_at: NOW,
  },
];
