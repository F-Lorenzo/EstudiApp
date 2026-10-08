import { makeDb, as, ids, expectFail, expectOk, report } from "./harness.mjs";
import { seed } from "./seed.mjs";

const r = [];
const db = await makeDb();
await seed(db);
const q = (sql) => db.query(sql);
const SLOT_FREE = "51000000-0000-0000-0000-000000000001";
const SLOT_BOOKED = "51000000-0000-0000-0000-000000000002";

// --- 0006: roles
await as(db, "alumno", () => expectFail("alumno NO puede ascenderse a administrador", q(`update public.profiles set role='administrador' where id='${ids.alumno}'`), r));
await as(db, "alumno", () => expectOk("alumno SI puede cambiar su nombre", q(`update public.profiles set full_name='Lucia' where id='${ids.alumno}'`), r));
await as(db, "admin", () => expectOk("administrador SI puede cambiar un rol", q(`update public.profiles set role='alumno' where id='${ids.alumno2}'`), r));

// --- 0006: tutor_profiles
await as(db, "docente2", () => expectFail("docente NO puede aprobarse solo", q(`update public.tutor_profiles set verification_status='aprobado' where id='${ids.docente2}'`), r));
await as(db, "docente", () => expectFail("docente NO puede cambiar su rating", q(`update public.tutor_profiles set rating_promedio=5 where id='${ids.docente}'`), r));
await as(db, "docente", () => expectFail("docente NO puede fijar su cuenta de Mercado Pago", q(`update public.tutor_private set mercadopago_account_id='x' where id='${ids.docente}'`), r));
await as(db, "docente", () => expectOk("docente SI puede editar bio y tarifa", q(`update public.tutor_profiles set bio='Nueva', tarifa_por_clase=11000 where id='${ids.docente}'`), r));
await as(db, "admin", () => expectOk("administrador SI rechaza con motivo", q(`update public.tutor_profiles set verification_status='rechazado', verification_reason='Faltan datos' where id='${ids.docente2}'`), r));
await as(db, "docente2", () => expectFail("rechazado NO puede pasar a aprobado", q(`update public.tutor_profiles set verification_status='aprobado', verification_reason=null where id='${ids.docente2}'`), r));
await as(db, "docente2", () => expectFail("rechazado NO puede cambiar el motivo sin reenviar", q(`update public.tutor_profiles set verification_reason='x' where id='${ids.docente2}'`), r));
await as(db, "docente2", () => expectOk("rechazado SI puede reenviar a pendiente", q(`update public.tutor_profiles set verification_status='pendiente', verification_reason=null where id='${ids.docente2}'`), r));
await as(db, "admin", () => expectOk("administrador SI aprueba", q(`update public.tutor_profiles set verification_status='aprobado' where id='${ids.docente2}'`), r));

// --- 0006: visibilidad
await as(db, "alumno", async () => {
  const x = await q(`select id from public.availability_slots where id='${SLOT_BOOKED}'`);
  r.push([x.rows.length === 1, "alumno ve el horario de SU reserva (is_booked=true)"]);
});
await as(db, "alumno2", async () => {
  const x = await q(`select id from public.availability_slots where id='${SLOT_BOOKED}'`);
  r.push([x.rows.length === 0, "otro alumno NO ve ese horario reservado"]);
});
await as(db, "alumno", async () => {
  const x = await q(`select b.id, s.starts_at from public.bookings b join public.availability_slots s on s.id=b.slot_id where b.student_id='${ids.alumno}'`);
  r.push([x.rows.length === 2, `join reserva+horario del alumno devuelve ${x.rows.length} de 2`]);
});
await db.exec(`update public.tutor_profiles set verification_status='pendiente' where id='${ids.docente2}'`);
await as(db, "admin", async () => {
  const x = await q(`select subject_id from public.tutor_subjects where tutor_id='${ids.docente2}'`);
  r.push([x.rows.length === 1, "admin ve las materias de un docente PENDIENTE"]);
});
await as(db, "alumno2", async () => {
  const x = await q(`select subject_id from public.tutor_subjects where tutor_id='${ids.docente2}'`);
  r.push([x.rows.length === 0, "un alumno NO ve las materias de un pendiente"]);
});

// --- 0006: rating automatico
await as(db, "alumno", () => expectOk("alumno califica una clase completada", q(`insert into public.ratings (booking_id, student_id, tutor_id, score, comment) values ('b0000000-0000-0000-0000-000000000003','${ids.alumno}','${ids.docente}',4,'Muy bien')`), r));
{
  const x = await q(`select rating_promedio from public.tutor_profiles where id='${ids.docente}'`);
  r.push([Number(x.rows[0].rating_promedio) === 4, `rating_promedio se recalcula (${x.rows[0].rating_promedio})`]);
}
await as(db, "alumno", () => expectFail("alumno NO califica una clase no completada", q(`insert into public.ratings (booking_id, student_id, tutor_id, score) values ('b0000000-0000-0000-0000-000000000002','${ids.alumno}','${ids.docente}',5)`), r));

// --- 0007
await as(db, "docente", () => expectFail("0007: docente NO puede duplicar una franja", q(`insert into public.availability_slots (tutor_id, starts_at, ends_at) select tutor_id, starts_at, ends_at from public.availability_slots where id='${SLOT_FREE}'`), r));

// --- lo que 0008 y 0010 cerraron (ya no son problemas conocidos)
await as(db, "anon", () => expectFail("un visitante NO puede leer los datos privados de un docente (0010)", q(`select contacto_verificacion, credential_url from public.tutor_private where id='${ids.docente}'`), r));
await as(db, "alumno", () => expectFail("un alumno NO puede insertar una reserva 'confirmada' sin pagar (0008)", q(`insert into public.bookings (student_id, tutor_id, slot_id, status) values ('${ids.alumno}','${ids.docente}','${SLOT_FREE}','confirmada')`), r));

report(r);
