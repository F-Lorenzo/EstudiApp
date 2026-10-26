// Migración 0020: métricas de la administración. Se prueba que solo la administración las vea y que cada cifra
// cuente lo que dice: pagos aprobados, clases dadas, comisión neta de reembolsos, cancelaciones, ausencias,
// reservas sin pagar, docentes y alumnos activos, calificaciones y la serie por semana.
import { makeDb, as, ids, expectFail, report } from "./harness.mjs";
import { seed } from "./seed.mjs";
import { makeBookingHelpers } from "./booking-helpers.mjs";

const r = [];
const db = await makeDb();
await seed(db);
const q = (sql) => db.query(sql);
const { reservaPaga, reservaSinPagar, cancelarA } = makeBookingHelpers(db, { slotPrefix: "5a200000" });
const metricas = (weeks = 8) => as(db, "admin", async () => (await q(`select public.admin_metrics(${weeks}) as m`)).rows[0].m);

const antes = await metricas();
const n = (v) => Number(v);

// Una clase dada hace 3 días (pagada hace 5), una próxima, una cancelada con 100 % y una ausencia del docente.
const dada = await reservaPaga({ price: 10000 });
await db.exec(`update public.bookings set status = 'completada', starts_at = now() - interval '3 days', ends_at = now() - interval '3 days' + interval '1 hour' where id = '${dada.booking}'`);
await db.exec(`update public.payments set created_at = now() - interval '5 days' where booking_id = '${dada.booking}'`);
await reservaPaga({ price: 8000 });
const cancelada = await reservaPaga({ price: 6000 });
await cancelarA(cancelada.booking, "alumno", 3 * 24 * 60);
await as(db, "service", () => q(`select public.mark_refund_result((select id from public.refunds where booking_id = '${cancelada.booking}'), 'aprobado', 'rf-200')`));
const ausente = await reservaPaga({ price: 5000 });
await db.exec(`update public.bookings set starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour' where id = '${ausente.booking}'`);
await as(db, "service", () => q(`select public.record_class_attendance('${ausente.booking}', 0, 3600)`));
const vencida = await reservaSinPagar();
await db.exec(`update public.bookings set created_at = now() - interval '1 hour' where id = '${vencida.booking}'`);
await as(db, "alumno", () => q(`select public.sync_bookings()`));
// Una calificación de la clase dada.
await as(db, "alumno", () => q(`insert into public.ratings (booking_id, student_id, tutor_id, score) values ('${dada.booking}', '${ids.alumno}', '${ids.docente}', 4)`));

const m = await metricas();
const d = (k) => n(m.last_30_days[k]) - n(antes.last_30_days[k]);

r.push([d("paid_bookings") === 4, `reservas pagas en 30 días: +${d("paid_bookings")} (las cuatro con pago aprobado)`]);
r.push([d("classes_given") === 1, `clases dadas: +${d("classes_given")}`]);
r.push([d("revenue") === 29000, `ingresos brutos: +${d("revenue")} (10000 + 8000 + 6000 + 5000)`]);
r.push([d("refunded") === 6000, `reembolsado: +${d("refunded")} (solo el aprobado; el de la ausencia sigue pendiente)`]);
r.push([d("paid_cancellations") === 2, `cancelaciones de clases pagas: +${d("paid_cancellations")} (la del alumno y la ausencia)`]);
r.push([d("tutor_absences") === 1, `ausencias del docente: +${d("tutor_absences")}`]);
r.push([d("expired_holds") === 1, `reservas que vencieron sin pagarse: +${d("expired_holds")}`]);
{
  const com = (await q(`select coalesce(sum(commission_amount), 0) as c from public.payments where status = 'aprobado' and created_at >= now() - interval '30 days'`)).rows[0].c;
  r.push([n(m.last_30_days.commission) === n(com), `la comisión es la vigente de los pagos (neta de reembolsos): ${m.last_30_days.commission}`]);
  const cancelPay = (await q(`select commission_amount, refunded_amount from public.payments where booking_id = '${cancelada.booking}'`)).rows[0];
  r.push([n(cancelPay.refunded_amount) === 6000 && n(cancelPay.commission_amount) === 0, "...una clase devuelta al 100 % ya no suma comisión"]);
}
r.push([m.tutors.active_30d >= 1 && m.tutors.approved >= 1 && m.tutors.payable >= 1, `docentes: ${JSON.stringify(m.tutors)}`]);
r.push([m.students.active_30d >= 1 && m.students.total >= 2, `alumnos: ${JSON.stringify(m.students)}`]);
r.push([n(m.ratings.count) - n(antes.ratings.count) === 1 && m.ratings.count_30d >= 1 && m.ratings.average !== null, `calificaciones: ${JSON.stringify(m.ratings)}`]);

// La serie por semana.
{
  r.push([Array.isArray(m.weeks) && m.weeks.length === 8, `8 semanas (${m.weeks.length})`]);
  const dias = m.weeks.map((w) => new Date(`${w.week_start}T12:00:00Z`).getUTCDay());
  r.push([dias.every((x) => x === 1), "cada semana empieza un lunes"]);
  const suma = (k) => m.weeks.reduce((s, w) => s + n(w[k]), 0) - antes.weeks.reduce((s, w) => s + n(w[k]), 0);
  r.push([suma("paid_bookings") === 4 && suma("revenue") === 29000 && suma("classes_given") === 1, "la serie reparte lo mismo que el total"]);
  r.push([(await metricas(100)).weeks.length === 26 && (await metricas(0)).weeks.length === 1, "pide entre 1 y 26 semanas"]);
}

// Solo la administración.
for (const who of ["alumno", "docente", "service"]) {
  const hint = await as(db, who, () => q(`select public.admin_metrics()`)).then(() => null, (e) => e.hint);
  r.push([hint === "not_admin", `${who} NO ve las métricas (${hint})`]);
}
await as(db, "anon", () => expectFail("un visitante NO ve las métricas", q(`select public.admin_metrics()`), r));

report(r);
