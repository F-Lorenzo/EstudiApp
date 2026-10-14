// Ayudantes compartidos por las suites de cobro (cancelación con reembolso, cuentas de cobro, emails): armar
// una reserva con pago aprobado y cancelarla con la clase empezando a una distancia EXACTA. No es una suite
// (el corredor solo ejecuta los archivos `*.db.mjs`).
import { as, ids } from "./harness.mjs";

/**
 * @param db           la base (PGlite) ya sembrada con `seed()`
 * @param slotPrefix   8 caracteres hexadecimales distintos en cada suite, para que los ids de franja no choquen
 */
export function makeBookingHelpers(db, { slotPrefix }) {
  const q = (sql) => db.query(sql);
  let seq = 0;
  const S = (n) => `${slotPrefix}-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;

  /** Una franja libre del docente, dentro de varios días (cada llamada usa un día distinto). */
  async function franja(tutor = "docente", dias = 10) {
    seq++;
    await db.exec(`insert into public.availability_slots (id, tutor_id, starts_at, ends_at)
      values ('${S(seq)}', '${ids[tutor] ?? tutor}', now() + interval '${dias + seq} days', now() + interval '${dias + seq} days 1 hour')`);
    return S(seq);
  }

  /** Reserva (sin pagar) como `student`, con una franja nueva del docente. */
  async function reservaSinPagar({ student = "alumno", tutor = "docente" } = {}) {
    const slot = await franja(tutor);
    const booking = await as(db, student, async () => (await q(`select public.create_booking('${slot}') as id`)).rows[0].id);
    return { booking, slot };
  }

  /** Crea una reserva con un pago aprobado. Devuelve ids y el identificador de Mercado Pago del pago. */
  async function reservaPaga({ price = 10000, student = "alumno", tutor = "docente", mp } = {}) {
    await db.exec(`update public.tutor_profiles set tarifa_por_clase = ${price} where id = '${ids[tutor] ?? tutor}'`);
    const { booking, slot } = await reservaSinPagar({ student, tutor });
    const mpId = mp ?? `mp-${slotPrefix.slice(0, 2)}-${seq}`;
    await as(db, "service", () => q(`select public.confirm_booking_payment('${booking}', '${mpId}', ${price})`));
    const payment = (await q(`select id from public.payments where booking_id = '${booking}'`)).rows[0].id;
    return { booking, slot, mp: mpId, price, payment };
  }

  /**
   * Cancela la reserva como `who`, con la clase empezando dentro de `minutes` minutos EXACTOS. Todo ocurre en UNA
   * transacción, y `now()` vale lo mismo en toda la transacción: así los límites de la política (exactamente 24 h,
   * exactamente 2 h) se prueban de verdad, sin la demora entre una consulta y la otra. Si la cancelación falla se deshace
   * todo (también el cambio de horario). Devuelve `{ result }` o `{ error }`.
   */
  async function cancelarA(booking, who, minutes, reason = null) {
    await db.exec("begin");
    try {
      await db.exec(`update public.bookings
        set starts_at = now() + (${minutes} * interval '1 minute'), ends_at = now() + (${minutes} * interval '1 minute') + interval '1 hour'
        where id = '${booking}'`);
      await db.exec(`select set_config('request.jwt.claim.sub', '${ids[who]}', true); set local role authenticated;`);
      const x = await db.query(`select public.cancel_booking('${booking}', ${reason === null ? "null" : `'${reason}'`}) as r`);
      await db.exec("reset role; commit");
      return { result: x.rows[0].r };
    } catch (error) {
      await db.exec("rollback");
      return { error };
    }
  }

  return { S, franja, reservaSinPagar, reservaPaga, cancelarA };
}
