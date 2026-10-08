// Un caso por cada hallazgo confirmado de la revisión adversarial de las reservas.
import { makeDb, as, ids, expectFail, expectOk, report } from "./harness.mjs";
import { seed } from "./seed.mjs";

const r = [];
const db = await makeDb();
await seed(db);
const q = (sql) => db.query(sql);
const T = (n) => `51000000-0000-0000-0000-0000000001${String(n).padStart(2, "0")}`;
const HOLD_USER = "00000000-0000-0000-0000-0000000000a3";

const book = (slot) => q(`select public.create_booking('${slot}') as id`);
const hintOf = async (who, fn) => {
  try { await as(db, who, fn); return null; } catch (e) { return e.hint ?? `sin hint: ${String(e.message).slice(0, 60)}`; }
};
const expectHint = async (label, who, fn, hint) => {
  const got = await hintOf(who, fn);
  r.push([got === hint, `${label}  → hint=${got}`]);
};

// 1 (alto). Un alumno no puede crearse un perfil de docente aprobado.
await as(db, "alumno2", () => expectFail("alumno NO puede insertar tutor_profiles (aprobado y con calificación 5)",
  q(`insert into public.tutor_profiles (id, verification_status, tarifa_por_clase, rating_promedio, bio) values ('${ids.alumno2}', 'aprobado', 5, 5, 'falso')`), r));
await as(db, "alumno2", () => expectFail("alumno NO puede insertar tutor_profiles ni siquiera como pendiente (no es docente)",
  q(`insert into public.tutor_profiles (id, bio) values ('${ids.alumno2}', 'x')`), r));
// Un docente al que le falta la fila (caso borde) solo puede crearla pendiente y limpia.
await db.exec(`delete from public.tutor_profiles where id = '${ids.docente2}'`);
await as(db, "docente2", () => expectFail("docente NO puede crearse la fila como aprobado",
  q(`insert into public.tutor_profiles (id, verification_status) values ('${ids.docente2}', 'aprobado')`), r));
await as(db, "docente2", () => expectFail("docente NO puede crearse la fila con una calificación inventada",
  q(`insert into public.tutor_profiles (id, rating_promedio) values ('${ids.docente2}', 5)`), r));
await as(db, "docente2", () => expectOk("docente SI puede crearse la fila como pendiente",
  q(`insert into public.tutor_profiles (id, bio) values ('${ids.docente2}', 'mi bio')`), r));
await db.exec(`update public.tutor_profiles set verification_status = 'aprobado', tarifa_por_clase = 8000 where id = '${ids.docente2}'`);
// docente2 aprobado, con cuatro horarios en días distintos.
await db.exec(`
  update public.tutor_profiles set verification_status = 'aprobado', tarifa_por_clase = 8000 where id = '${ids.docente2}';
  insert into public.availability_slots (id, tutor_id, starts_at, ends_at) values
    ('${T(1)}', '${ids.docente2}', now() + interval '10 days', now() + interval '10 days 1 hour'),
    ('${T(2)}', '${ids.docente2}', now() + interval '11 days', now() + interval '11 days 1 hour'),
    ('${T(3)}', '${ids.docente2}', now() + interval '12 days', now() + interval '12 days 1 hour'),
    ('${T(4)}', '${ids.docente2}', now() + interval '13 days', now() + interval '13 days 1 hour');
`);

// 1b. Aunque exista una fila aprobada de una cuenta que no es docente, no se le reserva.
await db.exec(`
  insert into auth.users (id, raw_user_meta_data) values ('${HOLD_USER}', '{"full_name":"alumno a3","role":"alumno"}');
  insert into public.tutor_profiles (id, verification_status, tarifa_por_clase) values ('${HOLD_USER}', 'aprobado', 5);
  insert into public.availability_slots (id, tutor_id, starts_at, ends_at)
    values ('${T(50)}', '${HOLD_USER}', now() + interval '9 days', now() + interval '9 days 1 hour');
`);
await expectHint("create_booking rechaza un 'docente' cuya cuenta no es de docente", "alumno", () => book(T(50)), "tutor_unavailable");

// 2 (medio). Cerrar una franja liberada ya no borra la reserva cancelada.
let bk;
await as(db, "alumno", async () => { bk = (await book(T(1))).rows[0].id; });
await as(db, "alumno", () => q(`select public.cancel_booking('${bk}', 'me arrepenti')`));
await as(db, "docente2", async () => {
  const x = await q(`delete from public.availability_slots where tutor_id = '${ids.docente2}' and is_booked = false and id = '${T(1)}' returning id`);
  r.push([x.rows.length === 1, "el docente cierra la franja liberada"]);
});
await as(db, "alumno", async () => {
  const x = await q(`select status, slot_id, starts_at, ends_at from public.bookings where id = '${bk}'`);
  r.push([x.rows.length === 1 && x.rows[0].status === "cancelada" && x.rows[0].slot_id === null && !!x.rows[0].starts_at,
    "la reserva cancelada sigue ahí, con su horario, y sin franja"]);
});

// 3 (medio). Confirmar un pago tardío siempre da el mismo resultado.
let late1, late2;
await as(db, "alumno", async () => { late1 = (await book(T(2))).rows[0].id; });
await as(db, "alumno2", async () => { late2 = (await book(T(3))).rows[0].id; });
await db.exec(`update public.bookings set created_at = now() - interval '3 days' where id in ('${late1}', '${late2}')`);
// late1: nadie barrió todavía. late2: se barre antes.
await expectHint("pago tardío SIN barrido previo: hold_expired", "service", () => q(`select public.confirm_booking_payment('${late1}', 'mp-l1', 8000)`), "hold_expired");
await as(db, "alumno2", () => q(`select public.sync_bookings()`));
await expectHint("pago tardío CON barrido previo: not_pending", "service", () => q(`select public.confirm_booking_payment('${late2}', 'mp-l2', 8000)`), "not_pending");
{
  const b = (await q(`select status from public.bookings where id = '${late1}'`)).rows[0];
  r.push([b.status === "cancelada", "tras el barrido, ambas quedan canceladas y sin pago"]);
}

// 3b. Monto, comisión y pagos duplicados.
let paid;
await as(db, "alumno", async () => { paid = (await book(T(2))).rows[0].id; });
await expectHint("monto distinto del precio: amount_mismatch", "service", () => q(`select public.confirm_booking_payment('${paid}', 'mp-x', 1, 0)`), "amount_mismatch");
await expectHint("comisión mayor al monto: invalid_commission", "service", () => q(`select public.confirm_booking_payment('${paid}', 'mp-x', 8000, 9000)`), "invalid_commission");
await expectHint("comisión negativa: invalid_commission", "service", () => q(`select public.confirm_booking_payment('${paid}', 'mp-x', 8000, -5)`), "invalid_commission");
await as(db, "service", () => expectOk("pago correcto", q(`select public.confirm_booking_payment('${paid}', 'mp-ok', 8000, 800)`), r));
await as(db, "service", () => expectOk("el MISMO pago repetido es idempotente", q(`select public.confirm_booking_payment('${paid}', 'mp-ok', 8000, 800)`), r));
await expectHint("un SEGUNDO pago distinto sobre la misma reserva: duplicate_payment", "service", () => q(`select public.confirm_booking_payment('${paid}', 'mp-otro', 8000, 800)`), "duplicate_payment");
{
  const p = (await q(`select mercadopago_payment_id, amount from public.payments where booking_id = '${paid}'`)).rows[0];
  r.push([p.mercadopago_payment_id === "mp-ok" && Number(p.amount) === 8000, "el pago original no se tocó"]);
}
// Clase que ya empezó.
await db.exec(`
  insert into public.availability_slots (id, tutor_id, starts_at, ends_at) values ('${T(60)}', '${ids.docente2}', now() + interval '2 hours', now() + interval '3 hours');
`);
let started;
await as(db, "alumno2", async () => { started = (await book(T(60))).rows[0].id; });
await db.exec(`update public.bookings set starts_at = now() - interval '5 minutes', ends_at = now() + interval '55 minutes' where id = '${started}'`);
await expectHint("pago de una clase que ya empezó: class_started", "service", () => q(`select public.confirm_booking_payment('${started}', 'mp-s', 8000)`), "class_started");
await as(db, "alumno2", () => q(`select public.cancel_booking('${started}')`));

// 4 (medio). Tope de reservas sin pagar y control de superposición.
const holds = [];
await as(db, "alumno2", async () => { holds.push((await book(T(3))).rows[0].id); holds.push((await book(T(4))).rows[0].id); });
r.push([holds.length === 2, "un alumno puede tener 2 reservas sin pagar"]);
await db.exec(`insert into public.availability_slots (id, tutor_id, starts_at, ends_at) values ('${T(70)}', '${ids.docente}', now() + interval '20 days', now() + interval '20 days 1 hour')`);
await expectHint("la tercera reserva sin pagar se rechaza: too_many_holds", "alumno2", () => book(T(70)), "too_many_holds");
await as(db, "alumno2", () => q(`select public.cancel_booking('${holds[0]}')`));
await as(db, "alumno2", () => expectOk("cancelando una, puede reservar otra", book(T(70)), r));

// 5. Reserva idempotente: el mismo alumno y el mismo horario devuelven la misma reserva.
let again;
await as(db, "alumno2", async () => { again = (await book(T(70))).rows[0].id; });
{
  const n = (await q(`select count(*)::int as n from public.bookings where slot_id = '${T(70)}' and status <> 'cancelada'`)).rows[0].n;
  r.push([n === 1, "reservar dos veces el mismo horario no crea una segunda reserva"]);
  const same = (await q(`select id from public.bookings where slot_id = '${T(70)}' and status <> 'cancelada'`)).rows[0].id;
  r.push([same === again, "...y devuelve la que ya existía (no slot_taken)"]);
}
await expectHint("otro alumno SI recibe slot_taken", "alumno", () => book(T(70)), "slot_taken");

// 6 (medio). Un horario vencido vuelve a verse sin que nadie haya barrido, si se barre como visitante.
await db.exec(`update public.bookings set created_at = now() - interval '30 minutes' where slot_id = '${T(70)}'`);
await as(db, "anon", async () => {
  const antes = await q(`select id from public.availability_slots where id = '${T(70)}'`);
  r.push([antes.rows.length === 0, "antes del barrido el visitante no ve el horario vencido"]);
});
await as(db, "anon", () => expectOk("un visitante SIN sesión puede ejecutar sync_bookings", q(`select public.sync_bookings()`), r));
await as(db, "anon", async () => {
  const despues = await q(`select id from public.availability_slots where id = '${T(70)}'`);
  r.push([despues.rows.length === 1, "después del barrido el visitante ve el horario libre"]);
});
await as(db, "anon", () => expectFail("un visitante NO puede crear reservas", book(T(70)), r));

// 7 (medio). El alumno sigue viendo a su docente aunque deje de estar aprobado; el docente ve a su alumno.
const seenId = holds[1];
const owner = ids.alumno2;
const ownerKey = "alumno2";
await db.exec(`update public.bookings set status = 'confirmada' where id = '${seenId}'`);
await db.exec(`update public.tutor_profiles set verification_status = 'rechazado' where id = '${ids.docente2}'`);
await as(db, ownerKey, async () => {
  const x = await q(`select b.id, p.full_name from public.bookings b
    join public.tutor_profiles tp on tp.id = b.tutor_id
    join public.profiles p on p.id = tp.id where b.id = '${seenId}'`);
  r.push([x.rows.length === 1, "el alumno sigue viendo a su docente rechazado en su reserva"]);
});
await as(db, HOLD_USER, async () => {
  const x = await q(`select id from public.profiles where id = '${ids.docente2}'`);
  r.push([x.rows.length === 0, "...pero un alumno sin reservas con él NO ve a ese docente rechazado"]);
});
await as(db, "docente2", async () => {
  const x = await q(`select full_name from public.profiles where id = '${owner}'`);
  r.push([x.rows.length === 1, "el docente ve el nombre de su alumno"]);
});
await as(db, HOLD_USER, async () => {
  const x = await q(`select full_name from public.profiles where id = '${owner}'`);
  r.push([x.rows.length === 0, "...pero otra cuenta sin relación NO ve a ese alumno"]);
});
await db.exec(`update public.tutor_profiles set verification_status = 'aprobado' where id = '${ids.docente2}'`);

// 8 (medio). Las clases terminadas pasan a completadas.
await db.exec(`
  insert into public.availability_slots (id, tutor_id, starts_at, ends_at, is_booked) values ('${T(80)}', '${ids.docente}', now() - interval '3 hours', now() - interval '2 hours', true);
  insert into public.bookings (id, student_id, tutor_id, slot_id, status, starts_at, ends_at)
    values ('b0000000-0000-0000-0000-000000000080', '${ids.alumno}', '${ids.docente}', '${T(80)}', 'confirmada', now() - interval '3 hours', now() - interval '2 hours');
`);
await as(db, "alumno", () => q(`select public.sync_bookings()`));
{
  const b = (await q(`select status from public.bookings where id = 'b0000000-0000-0000-0000-000000000080'`)).rows[0];
  const futura = (await q(`select status from public.bookings where id = 'b0000000-0000-0000-0000-000000000002'`)).rows[0];
  r.push([b.status === "completada", "una clase confirmada que ya terminó pasa a completada"]);
  r.push([futura.status === "confirmada", "una clase confirmada futura sigue confirmada"]);
}

// 9 (bajo). La administración no edita reservas a mano, y no se califica a otro docente.
await as(db, "admin", async () => {
  const x = await q(`update public.bookings set status = 'cancelada' where id = '${paid}' returning id`);
  r.push([x.rows.length === 0, "administración NO puede cambiar una reserva directo"]);
});
await as(db, "alumno", () => expectFail("calificar a OTRO docente con una clase completada ajena se rechaza",
  q(`insert into public.ratings (booking_id, student_id, tutor_id, score) values ('b0000000-0000-0000-0000-000000000003', '${ids.alumno}', '${ids.docente2}', 1)`), r));
await as(db, "alumno", () => expectOk("calificar al docente de esa clase sí se puede",
  q(`insert into public.ratings (booking_id, student_id, tutor_id, score) values ('b0000000-0000-0000-0000-000000000003', '${ids.alumno}', '${ids.docente}', 5)`), r));

// 10. Los permisos de las funciones.
await as(db, "alumno", () => expectFail("el alumno NO ejecuta confirm_booking_payment", q(`select public.confirm_booking_payment('${paid}', 'x', 8000)`), r));
await as(db, "anon", () => expectFail("anon NO ejecuta cancel_booking", q(`select public.cancel_booking('${paid}')`), r));

report(r);
