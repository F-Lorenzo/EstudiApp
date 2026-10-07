import type { SupabaseClient } from "@supabase/supabase-js";
import { earliestBookableIso } from "@/lib/bookings/hold";
import { syncBookings } from "@/lib/bookings/sync";

type ScoreEmbed = { score: number } | { score: number }[] | null;

export type StudentBookingRow = {
  id: string;
  status: string;
  tutor_id: string;
  price: number | null;
  created_at: string;
  starts_at: string;
  ends_at: string;
  tutor_profiles: {
    profiles: { full_name: string; avatar_url: string | null } | null;
  } | null;
  ratings?: ScoreEmbed;
};

/** Clase lista para mostrar en la interfaz. */
export type ClassItem = {
  id: string;
  /** `pendiente_pago`, `confirmada`, `completada` o `cancelada`. */
  status: string;
  startsAt: string;
  endsAt: string;
  tutorId: string;
  tutorName: string;
  tutorPhoto: string | null;
  /** Precio acordado al reservar (puede ser `null` en reservas anteriores). */
  price: number | null;
  /** Cuándo se creó la reserva (para el vencimiento de las que faltan pagar). */
  createdAt: string;
  /** Calificación que dejó el alumno, si ya calificó. */
  score: number | null;
};

// El horario sale de la propia reserva (`starts_at`, `ends_at`): sigue ahí aunque
// el docente cierre la franja después de una cancelación.
const SELECT_STUDENT =
  "id, status, tutor_id, price, created_at, starts_at, ends_at, tutor_profiles(profiles(full_name, avatar_url)), ratings(score)";

function toClassItem(row: StudentBookingRow): ClassItem {
  const rating = Array.isArray(row.ratings) ? row.ratings[0] : row.ratings;
  return {
    id: row.id,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    tutorId: row.tutor_id,
    tutorName: row.tutor_profiles?.profiles?.full_name || "Docente",
    tutorPhoto: row.tutor_profiles?.profiles?.avatar_url ?? null,
    price: row.price == null ? null : Number(row.price),
    createdAt: row.created_at,
    score: rating?.score ?? null,
  };
}

async function listStudentClasses(
  supabase: SupabaseClient,
  studentId: string,
  statuses: string[],
) {
  await syncBookings(supabase);
  const { data, error } = await supabase
    .from("bookings")
    .select(SELECT_STUDENT)
    .eq("student_id", studentId)
    .in("status", statuses)
    .returns<StudentBookingRow[]>();

  return { error, classes: (data ?? []).map(toClassItem) };
}

// Reservas del alumno que siguen en pie (pagas o por pagar), próximas primero.
// Las clases que ya terminaron pasan solas a «completada» (`syncBookings`).
export async function getUpcomingClasses(
  supabase: SupabaseClient,
  studentId: string,
) {
  const { classes, error } = await listStudentClasses(supabase, studentId, [
    "confirmada",
    "pendiente_pago",
  ]);
  return {
    error,
    classes: classes.sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
  };
}

// Historial de clases completadas del alumno, más recientes primero.
export async function getCompletedClasses(
  supabase: SupabaseClient,
  studentId: string,
) {
  const { classes, error } = await listStudentClasses(supabase, studentId, [
    "completada",
  ]);
  return {
    error,
    classes: classes.sort((a, b) => b.startsAt.localeCompare(a.startsAt)),
  };
}

/** Detalle de una reserva del alumno, con el estado de su pago. */
export type BookingDetail = ClassItem & {
  cancellationReason: string | null;
  paid: boolean;
  /** Materias del docente separadas por coma, para el resumen (la reserva no guarda una materia). */
  subject: string | null;
};

type BookingDetailRow = StudentBookingRow & {
  cancellation_reason: string | null;
  payments: { status: string } | { status: string }[] | null;
  tutor_profiles: {
    profiles: { full_name: string; avatar_url: string | null } | null;
    tutor_subjects: { subjects: { name: string } | null }[];
  } | null;
};

/**
 * Devuelve la reserva del alumno, o `null` si no existe o no es suya. Si la
 * consulta falla (red, base caída) lanza el error: no es lo mismo que una
 * reserva inexistente y no debe mostrarse como un 404.
 */
export async function getStudentBooking(
  supabase: SupabaseClient,
  bookingId: string,
  studentId: string,
) {
  await syncBookings(supabase);
  const { data, error } = await supabase
    .from("bookings")
    .select(
      "id, status, tutor_id, price, created_at, starts_at, ends_at, cancellation_reason, tutor_profiles(profiles(full_name, avatar_url), tutor_subjects(subjects(name))), payments(status)",
    )
    .eq("id", bookingId)
    .eq("student_id", studentId)
    .maybeSingle<BookingDetailRow>();

  if (error) throw new Error(`No se pudo leer la reserva: ${error.message}`);
  if (!data) return null;

  const payment = Array.isArray(data.payments) ? data.payments[0] : data.payments;
  const subjects = (data.tutor_profiles?.tutor_subjects ?? [])
    .map((row) => row.subjects?.name)
    .filter((name): name is string => Boolean(name))
    .sort((a, b) => a.localeCompare(b, "es"));
  return {
    ...toClassItem(data),
    cancellationReason: data.cancellation_reason,
    paid: payment?.status === "aprobado",
    subject: subjects.join(", ") || null,
  } satisfies BookingDetail;
}

/** Horario libre de un docente que se puede reservar. */
export type BookableSlot = { id: string; startsAt: string; endsAt: string };

/**
 * Horarios libres de un docente. La RLS solo deja ver los libres de docentes
 * aprobados; además se descartan los que empiezan en menos de una hora, que
 * `create_booking` rechazaría. Antes se liberan las reservas vencidas: un
 * horario abandonado no debe seguir oculto.
 */
export async function getBookableSlots(
  supabase: SupabaseClient,
  tutorId: string,
) {
  await syncBookings(supabase);
  const { data, error } = await supabase
    .from("availability_slots")
    .select("id, starts_at, ends_at")
    .eq("tutor_id", tutorId)
    .eq("is_booked", false)
    .gte("starts_at", earliestBookableIso())
    .order("starts_at")
    .limit(200)
    .returns<{ id: string; starts_at: string; ends_at: string }[]>();

  // Un error no es «sin horarios»: no se le dice a la persona que el docente no tiene lugar.
  if (error) throw new Error(`No se pudieron leer los horarios: ${error.message}`);

  return (data ?? []).map(
    (row): BookableSlot => ({
      id: row.id,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
    }),
  );
}
