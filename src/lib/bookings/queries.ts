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
  /** Solo las apelaciones aceptadas: la RLS (migración 0027) no le muestra otras al alumno. */
  rating_appeals?: { status: string }[] | null;
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
  /** La administración quitó su opinión de esta clase (apelación aceptada): no se vuelve a calificar. */
  ratingRemoved: boolean;
};

// El horario sale de la propia reserva (`starts_at`, `ends_at`): sigue ahí aunque
// el docente cierre la franja después de una cancelación.
const SELECT_STUDENT =
  "id, status, tutor_id, price, created_at, starts_at, ends_at, tutor_profiles(profiles(full_name, avatar_url)), ratings(score), rating_appeals(status)";

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
    ratingRemoved: (row.rating_appeals ?? []).some((appeal) => appeal.status === "aceptada"),
  };
}

/** Una clase confirmada cuyo horario ya terminó (espera que se registre su asistencia). */
export function hasEnded(item: Pick<ClassItem, "status" | "endsAt">, now = Date.now()) {
  return item.status === "confirmada" && new Date(item.endsAt).getTime() <= now;
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
  const now = Date.now();
  return {
    error,
    classes: classes
      // Una confirmada que ya terminó espera su asistencia: va al historial, no a las próximas.
      .filter((item) => !hasEnded(item, now))
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
  };
}

// Historial del alumno (completadas y terminadas que esperan su asistencia), más recientes primero.
export async function getCompletedClasses(
  supabase: SupabaseClient,
  studentId: string,
) {
  const { classes, error } = await listStudentClasses(supabase, studentId, [
    "completada",
    "confirmada",
  ]);
  const now = Date.now();
  return {
    error,
    classes: classes
      // Las confirmadas que ya terminaron esperan su asistencia (migración 0017): se muestran como tales.
      .filter((item) => item.status === "completada" || hasEnded(item, now))
      .sort((a, b) => b.startsAt.localeCompare(a.startsAt)),
  };
}

/** Reembolso de una reserva cancelada, tal como lo ve el alumno. */
export type BookingRefund = {
  /** Porcentaje devuelto (o por devolver). */
  percent: number;
  amount: number;
  /** `aprobado` ya se devolvió; `pendiente` y `fallido` siguen en proceso (se reintentan solos). */
  status: "pendiente" | "aprobado" | "fallido";
};

/** Detalle de una reserva del alumno, con el estado de su pago. */
export type BookingDetail = ClassItem & {
  cancellationReason: string | null;
  paid: boolean;
  /** Materias del docente separadas por coma, para el resumen (la reserva no guarda una materia). */
  subject: string | null;
  /** Reembolso de la reserva, si lo hubo (la cancelación de una reserva paga lo genera). */
  refund: BookingRefund | null;
  /** Hubo un pago aprobado, aunque después se haya devuelto (`paid` solo vale mientras el pago sigue en pie). */
  everPaid: boolean;
};

type RefundEmbed = { percent: number; amount: number | string; status: BookingRefund["status"] };

type BookingDetailRow = StudentBookingRow & {
  cancellation_reason: string | null;
  payments: { status: string } | { status: string }[] | null;
  refunds: RefundEmbed | RefundEmbed[] | null;
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
      "id, status, tutor_id, price, created_at, starts_at, ends_at, cancellation_reason, tutor_profiles(profiles(full_name, avatar_url), tutor_subjects(subjects(name))), payments(status), refunds(percent, amount, status)",
    )
    .eq("id", bookingId)
    .eq("student_id", studentId)
    .maybeSingle<BookingDetailRow>();

  if (error) throw new Error(`No se pudo leer la reserva: ${error.message}`);
  if (!data) return null;

  const payment = Array.isArray(data.payments) ? data.payments[0] : data.payments;
  const refundRow = Array.isArray(data.refunds) ? data.refunds[0] : data.refunds;
  const subjects = (data.tutor_profiles?.tutor_subjects ?? [])
    .map((row) => row.subjects?.name)
    .filter((name): name is string => Boolean(name))
    .sort((a, b) => a.localeCompare(b, "es"));
  return {
    ...toClassItem(data),
    cancellationReason: data.cancellation_reason,
    paid: payment?.status === "aprobado",
    everPaid: payment?.status === "aprobado" || payment?.status === "reembolsado",
    refund: refundRow
      ? { percent: Number(refundRow.percent), amount: Number(refundRow.amount), status: refundRow.status }
      : null,
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
