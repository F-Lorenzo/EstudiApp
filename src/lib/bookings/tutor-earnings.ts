import type { SupabaseClient } from "@supabase/supabase-js";
import { syncBookings } from "@/lib/bookings/sync";
import { STUDENT_FALLBACK_NAME } from "@/lib/bookings/tutor-queries";

/**
 * Cobros de un docente: por cada clase cobrada, cuánto pagó el alumno, la comisión de EstudiApp y lo que le queda
 * al docente (decisión del 26 de octubre de 2026), más los reembolsos de las clases canceladas.
 *
 * Todo sale de lo que el docente ya puede leer con SU sesión (la RLS de `payments` y `refunds` le deja ver solo
 * las de sus reservas). Las cifras son las de la base: cuando un reembolso se aprueba, `apply_refund_result`
 * recalcula la comisión y lo que le queda al docente sobre lo que no se devolvió (migración 0011). Mientras un
 * reembolso está en curso, el pago todavía muestra las cifras completas: la pantalla lo aclara.
 */

export type EarningStatus =
  /** Confirmada y todavía no terminó. */
  | "proxima"
  /** Confirmada y terminada: se está registrando la asistencia (migración 0017). */
  | "confirmando"
  | "completada"
  | "cancelada";

export type EarningRefund = {
  amount: number;
  percent: number;
  /** «en_curso» mientras Mercado Pago no lo confirmó (pendiente o con reintentos). */
  state: "hecho" | "en_curso";
};

export type TutorEarning = {
  id: string;
  startsAt: string;
  endsAt: string;
  status: EarningStatus;
  studentName: string;
  /** Lo que pagó el alumno. */
  paid: number;
  /** Comisión de EstudiApp sobre lo que no se devolvió. */
  commission: number;
  /** Lo que le queda al docente. */
  tutorAmount: number;
  /** Ya devuelto al alumno (reembolsos aprobados). */
  refunded: number;
  refund: EarningRefund | null;
};

export type EarningsTotals = {
  /** Lo que le queda por las clases dadas. */
  earned: number;
  /** Comisión de las clases dadas. */
  commission: number;
  /** Lo que le va a quedar por las clases confirmadas que todavía no se dieron (o esperan su asistencia). */
  upcoming: number;
  /** Devuelto (o devolviéndose) a los alumnos por clases canceladas. */
  refunded: number;
};

type Embed<T> = T | T[] | null | undefined;
const one = <T>(value: Embed<T>): T | null => (Array.isArray(value) ? (value[0] ?? null) : (value ?? null));
const num = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

type PaymentEmbed = {
  status: string;
  amount: number | string;
  commission_amount: number | string;
  tutor_amount: number | string;
  refunded_amount: number | string | null;
};
type RefundEmbed = { amount: number | string; percent: number; status: string };

export type EarningRow = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  profiles?: Embed<{ full_name: string | null }>;
  payments?: Embed<PaymentEmbed>;
  refunds?: RefundEmbed[] | null;
};

export function toTutorEarning(row: EarningRow, now: Date = new Date()): TutorEarning | null {
  const payment = one(row.payments);
  // Solo las clases cobradas: «aprobado», o «reembolsado» si después se devolvió entero (migración 0011). Una
  // reserva sin pago no dejó plata (ni a cobrar ni a devolver).
  if (!payment || (payment.status !== "aprobado" && payment.status !== "reembolsado")) return null;
  let status: EarningStatus;
  if (row.status === "completada") status = "completada";
  else if (row.status === "cancelada") status = "cancelada";
  else if (row.status === "confirmada")
    status = new Date(row.ends_at).getTime() > now.getTime() ? "proxima" : "confirmando";
  else return null;

  const refunds = row.refunds ?? [];
  const refundAmount = refunds.reduce((sum, r) => sum + num(r.amount), 0);
  const refund: EarningRefund | null = refunds.length
    ? {
        amount: refundAmount,
        percent: Math.max(...refunds.map((r) => num(r.percent))),
        state: refunds.every((r) => r.status === "aprobado") ? "hecho" : "en_curso",
      }
    : null;

  return {
    id: row.id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status,
    studentName: one(row.profiles)?.full_name?.trim() || STUDENT_FALLBACK_NAME,
    paid: num(payment.amount),
    commission: num(payment.commission_amount),
    tutorAmount: num(payment.tutor_amount),
    refunded: num(payment.refunded_amount),
    refund,
  };
}

const round = (value: number) => Math.round(value * 100) / 100;

export function earningsTotals(items: TutorEarning[]): EarningsTotals {
  const totals = { earned: 0, commission: 0, upcoming: 0, refunded: 0 };
  for (const item of items) {
    if (item.status === "completada") {
      totals.earned += item.tutorAmount;
      totals.commission += item.commission;
    } else if (item.status === "proxima" || item.status === "confirmando") {
      totals.upcoming += item.tutorAmount;
    }
    totals.refunded += item.refund?.amount ?? item.refunded;
  }
  return {
    earned: round(totals.earned),
    commission: round(totals.commission),
    upcoming: round(totals.upcoming),
    refunded: round(totals.refunded),
  };
}

/** Las clases pagadas del docente, de la más reciente a la más vieja (hasta 200). */
export async function getTutorEarnings(supabase: SupabaseClient, tutorId: string, now: Date = new Date()) {
  await syncBookings(supabase);
  const { data, error } = await supabase
    .from("bookings")
    .select(
      "id, starts_at, ends_at, status, profiles(full_name), payments(status, amount, commission_amount, tutor_amount, refunded_amount), refunds(amount, percent, status)",
    )
    .eq("tutor_id", tutorId)
    .in("status", ["confirmada", "completada", "cancelada"])
    .order("starts_at", { ascending: false })
    .limit(200)
    .returns<EarningRow[]>();
  const items = (data ?? []).flatMap((row) => {
    const item = toTutorEarning(row, now);
    return item ? [item] : [];
  });
  return { items, totals: earningsTotals(items), error };
}
