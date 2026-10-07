import type { SupabaseClient } from "@supabase/supabase-js";

type ScoreEmbed = { score: number } | { score: number }[] | null;

export type StudentBookingRow = {
  id: string;
  status: string;
  tutor_id: string;
  price: number | null;
  created_at: string;
  availability_slots: { starts_at: string; ends_at: string } | null;
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

const SELECT_STUDENT =
  "id, status, tutor_id, price, created_at, availability_slots!inner(starts_at, ends_at), tutor_profiles!inner(profiles(full_name, avatar_url)), ratings(score)";

function toClassItem(row: StudentBookingRow): ClassItem | null {
  if (!row.availability_slots) return null;
  const rating = Array.isArray(row.ratings) ? row.ratings[0] : row.ratings;
  return {
    id: row.id,
    status: row.status,
    startsAt: row.availability_slots.starts_at,
    endsAt: row.availability_slots.ends_at,
    tutorId: row.tutor_id,
    tutorName: row.tutor_profiles?.profiles?.full_name || "Docente",
    tutorPhoto: row.tutor_profiles?.profiles?.avatar_url ?? null,
    price: row.price == null ? null : Number(row.price),
    createdAt: row.created_at,
    score: rating?.score ?? null,
  };
}

/**
 * Las reservas sin pagar vencen a los 15 minutos. Se liberan acá, al consultar,
 * para que una reserva vencida no aparezca como pendiente. Si la función no
 * existe (falta la migración 0008) simplemente se omite.
 */
async function releaseExpiredHolds(supabase: SupabaseClient) {
  await supabase.rpc("expire_pending_bookings");
}

async function listStudentClasses(
  supabase: SupabaseClient,
  studentId: string,
  statuses: string[],
) {
  await releaseExpiredHolds(supabase);
  const { data, error } = await supabase
    .from("bookings")
    .select(SELECT_STUDENT)
    .eq("student_id", studentId)
    .in("status", statuses)
    .returns<StudentBookingRow[]>();

  return {
    error,
    classes: (data ?? [])
      .map(toClassItem)
      .filter((item): item is ClassItem => item !== null),
  };
}

// Reservas del alumno que siguen en pie (pagas o por pagar), próximas primero.
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
  /** Materia principal del docente, para el resumen. */
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

export async function getStudentBooking(
  supabase: SupabaseClient,
  bookingId: string,
  studentId: string,
) {
  await releaseExpiredHolds(supabase);
  const { data } = await supabase
    .from("bookings")
    .select(
      "id, status, tutor_id, price, created_at, cancellation_reason, availability_slots(starts_at, ends_at), tutor_profiles(profiles(full_name, avatar_url), tutor_subjects(subjects(name))), payments(status)",
    )
    .eq("id", bookingId)
    .eq("student_id", studentId)
    .single<BookingDetailRow>();

  if (!data) return null;
  const item = toClassItem(data);
  if (!item) return null;
  const payment = Array.isArray(data.payments) ? data.payments[0] : data.payments;
  const subjects = (data.tutor_profiles?.tutor_subjects ?? [])
    .map((row) => row.subjects?.name)
    .filter((name): name is string => Boolean(name))
    .sort((a, b) => a.localeCompare(b, "es"));
  return {
    ...item,
    cancellationReason: data.cancellation_reason,
    paid: payment?.status === "aprobado",
    subject: subjects[0] ?? null,
  } satisfies BookingDetail;
}

/** Horario libre de un docente que se puede reservar. */
export type BookableSlot = { id: string; startsAt: string; endsAt: string };

/**
 * Horarios libres de un docente. La RLS solo deja ver los libres de docentes
 * aprobados; además se descartan los que empiezan en menos de una hora, que
 * `create_booking` rechazaría.
 */
export async function getBookableSlots(
  supabase: SupabaseClient,
  tutorId: string,
) {
  const earliest = new Date(Date.now() + 60 * 60_000).toISOString();
  const { data } = await supabase
    .from("availability_slots")
    .select("id, starts_at, ends_at")
    .eq("tutor_id", tutorId)
    .eq("is_booked", false)
    .gte("starts_at", earliest)
    .order("starts_at")
    .limit(200)
    .returns<{ id: string; starts_at: string; ends_at: string }[]>();
  return (data ?? []).map(
    (row): BookableSlot => ({
      id: row.id,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
    }),
  );
}
