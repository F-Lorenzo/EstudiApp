import { makeDb, as, ids, expectFail, expectOk, report } from "./harness.mjs";
import { seed } from "./seed.mjs";

const r = [];
const db = await makeDb();
await seed(db);
const q = (sql) => db.query(sql);
const S_FREE = "51000000-0000-0000-0000-000000000001"; // docente, +3 dias, libre
const S_OVERLAP = "51000000-0000-0000-0000-000000000011"; // docente2, mismo horario que S_FREE
const S_SOON = "51000000-0000-0000-0000-000000000012"; // docente, en 30 minutos
const S_PAST = "51000000-0000-0000-0000-000000000013"; // docente, ayer, libre
const S_PENDING_TUTOR = "51000000-0000-0000-0000-000000000014"; // docente2 (pendiente de aprobacion)
const S_OTHER = "51000000-0000-0000-0000-000000000015"; // docente, +6 dias, libre

await db.exec(`
  insert into public.availability_slots (id, tutor_id, starts_at, ends_at) values
    ('${S_SOON}', '${ids.docente}', now() + interval '30 minutes', now() + interval '90 minutes'),
    ('${S_PAST}', '${ids.docente}', now() - interval '1 day', now() - interval '1 day' + interval '1 hour'),
    ('${S_PENDING_TUTOR}', '${ids.docente2}', now() + interval '8 days', now() + interval '8 days 1 hour'),
    ('${S_OTHER}', '${ids.docente}', now() + interval '6 days', now() + interval '6 days 1 hour');
`);
const t = (await q(`select starts_at, ends_at from public.availability_slots where id = '${S_FREE}'`)).rows[0];
await db.exec(`
  update public.tutor_profiles set verification_status = 'aprobado', tarifa_por_clase = 9000 where id = '${ids.docente2}';
  insert into public.availability_slots (id, tutor_id, starts_at, ends_at)
    values ('${S_OVERLAP}', '${ids.docente2}', '${t.starts_at.toISOString()}', '${t.ends_at.toISOString()}');
`);
// docente2 queda aprobado; el horario con docente "sin aprobar" usa un tercer docente.
await db.exec(`
  insert into auth.users (id, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000d3', '{"full_name":"docente pendiente","role":"docente"}');
  update public.availability_slots set tutor_id = '00000000-0000-0000-0000-0000000000d3' where id = '${S_PENDING_TUTOR}';
`);

const book = (slot) => q(`select public.create_booking('${slot}') as id`);
const failWithHint = async (label, who, fn, hint) => {
  await as(db, who, async () => {
    try { await fn(); r.push([false, `${label} (debía fallar y NO falló)`]); }
    catch (e) { r.push([e.hint === hint, `${label}  → hint=${e.hint} | ${String(e.message).slice(0, 70)}`]); }
  });
};

// --- el hueco que se cierra
await as(db, "alumno", () => expectFail("alumno NO puede insertar una reserva directo (ya no hay policy)", q(`insert into public.bookings (student_id, tutor_id, slot_id, status) values ('${ids.alumno}','${ids.docente}','${S_OTHER}','confirmada')`), r));
await as(db, "alumno", async () => {
  const x = await q(`update public.bookings set status = 'completada' where id = 'b0000000-0000-0000-0000-000000000002' returning id`);
  r.push([x.rows.length === 0, "alumno NO puede editar su reserva directo (0 filas afectadas)"]);
});
await as(db, "docente", async () => {
  const x = await q(`update public.bookings set status = 'completada' where id = 'b0000000-0000-0000-0000-000000000002' returning id`);
  r.push([x.rows.length === 0, "docente NO puede editar la reserva directo (0 filas afectadas)"]);
});

// --- crear reserva
let booking1;
await as(db, "alumno", async () => {
  const x = await book(S_FREE);
  booking1 = x.rows[0].id;
  r.push([!!booking1, "alumno reserva un horario libre"]);
});
{
  const b = (await q(`select status, price, student_id, tutor_id from public.bookings where id = '${booking1}'`)).rows[0];
  const s = (await q(`select is_booked from public.availability_slots where id = '${S_FREE}'`)).rows[0];
  r.push([b.status === "pendiente_pago" && Number(b.price) === 10000 && b.student_id === ids.alumno && b.tutor_id === ids.docente, `reserva queda pendiente_pago con el precio vigente (${b.price})`]);
  r.push([s.is_booked === true, "el horario queda retenido (is_booked)"]);
}
await failWithHint("otro alumno NO puede reservar el mismo horario", "alumno2", () => book(S_FREE), "slot_taken");
await failWithHint("un docente NO puede reservar", "docente", () => book(S_OTHER), "not_student");
await as(db, "anon", () => expectFail("anonimo NO puede ejecutar create_booking (sin permiso)", book(S_OTHER), r));
await failWithHint("no se reserva un horario que empieza en 30 min", "alumno2", () => book(S_SOON), "slot_too_soon");
await failWithHint("no se reserva un horario pasado", "alumno2", () => book(S_PAST), "slot_too_soon");
await failWithHint("no se reserva con un docente sin aprobar", "alumno2", () => book(S_PENDING_TUTOR), "tutor_unavailable");
await failWithHint("el mismo alumno NO puede tener dos clases que se pisan", "alumno", () => book(S_OVERLAP), "student_overlap");
await failWithHint("horario inexistente", "alumno2", () => book("99999999-9999-9999-9999-999999999999"), "slot_not_found");

// --- cancelar
await failWithHint("un tercero NO puede cancelar la reserva (no la ve)", "alumno2", () => q(`select public.cancel_booking('${booking1}')`), "not_found");
await as(db, "alumno", () => expectOk("el alumno cancela su reserva pendiente", q(`select public.cancel_booking('${booking1}', null)`), r));
{
  const b = (await q(`select status, cancellation_reason from public.bookings where id = '${booking1}'`)).rows[0];
  const s = (await q(`select is_booked from public.availability_slots where id = '${S_FREE}'`)).rows[0];
  r.push([b.status === "cancelada" && b.cancellation_reason === "Cancelada por el alumno", `queda cancelada (${b.cancellation_reason})`]);
  r.push([s.is_booked === false, "el horario vuelve a estar libre"]);
}
let booking2;
await as(db, "alumno2", async () => {
  booking2 = (await book(S_FREE)).rows[0].id;
  r.push([!!booking2, "otro alumno PUEDE reservar el horario liberado (indice parcial)"]);
});
await failWithHint("no se cancela dos veces", "alumno", () => q(`select public.cancel_booking('${booking1}')`), "not_cancellable");

// --- vencimiento
await db.exec(`update public.bookings set created_at = now() - interval '20 minutes' where id = '${booking2}'`);
await as(db, "alumno", async () => {
  const x = await q(`select public.sync_bookings() as n`);
  r.push([x.rows[0].n === 1, `vence la reserva sin pagar a los 15 min (liberó ${x.rows[0].n})`]);
});
{
  const b = (await q(`select status, cancellation_reason from public.bookings where id = '${booking2}'`)).rows[0];
  const s = (await q(`select is_booked from public.availability_slots where id = '${S_FREE}'`)).rows[0];
  r.push([b.status === "cancelada" && s.is_booked === false, `vencida: ${b.cancellation_reason} / horario libre`]);
}
// reservar vuelve a expirar solo
let booking3;
await as(db, "alumno", async () => { booking3 = (await book(S_FREE)).rows[0].id; r.push([!!booking3, "se reserva de nuevo el mismo horario"]); });
await db.exec(`update public.bookings set created_at = now() - interval '16 minutes' where id = '${booking3}'`);
await as(db, "alumno2", async () => { const x = await book(S_FREE); r.push([!!x.rows[0].id, "create_booking libera sola una reserva vencida y reserva"]); });
await db.exec(`update public.bookings set created_at = now() - interval '20 minutes' where status = 'pendiente_pago'`);
await db.exec(`select public.sync_bookings()`);

// --- confirmar pago (solo backend)
let booking4;
await as(db, "alumno", async () => { booking4 = (await book(S_OTHER)).rows[0].id; });
await as(db, "alumno", () => expectFail("el alumno NO puede confirmar su propio pago", q(`select public.confirm_booking_payment('${booking4}', 'mp-1', 10000)`), r));
await as(db, "docente", () => expectFail("el docente NO puede confirmar un pago", q(`select public.confirm_booking_payment('${booking4}', 'mp-1', 10000)`), r));
await as(db, "service", () => expectOk("service_role SI confirma el pago", q(`select public.confirm_booking_payment('${booking4}', 'mp-1', 10000, 1200)`), r));
{
  const b = (await q(`select status from public.bookings where id = '${booking4}'`)).rows[0];
  const p = (await q(`select status, amount, commission_amount, tutor_amount from public.payments where booking_id = '${booking4}'`)).rows[0];
  r.push([b.status === "confirmada" && p.status === "aprobado" && Number(p.tutor_amount) === 8800, `reserva confirmada y pago registrado (docente recibe ${p.tutor_amount})`]);
}
await as(db, "service", () => expectOk("confirmar dos veces es idempotente", q(`select public.confirm_booking_payment('${booking4}', 'mp-1', 10000, 1200)`), r));
await failWithHint("no se cancela una reserva ya paga (falta el reembolso)", "alumno", () => q(`select public.cancel_booking('${booking4}')`), "refund_required");
await as(db, "service", async () => {
  try { await q(`select public.confirm_booking_payment('${booking1}', 'mp-2', 10000)`); r.push([false, "confirmar una reserva cancelada (debia fallar)"]); }
  catch (e) { r.push([e.hint === "not_pending", `no se confirma una reserva cancelada/vencida  → hint=${e.hint}`]); }
});

// --- lectura
await as(db, "alumno2", async () => {
  const x = await q(`select id from public.bookings where id = '${booking4}'`);
  r.push([x.rows.length === 0, "otro alumno NO ve la reserva ajena"]);
});
await as(db, "docente", async () => {
  const x = await q(`select id from public.bookings where id = '${booking4}'`);
  r.push([x.rows.length === 1, "el docente ve la reserva de su clase"]);
});
await as(db, "admin", async () => {
  const x = await q(`update public.bookings set cancellation_reason = 'nota' where id = '${booking4}' returning id`);
  r.push([x.rows.length === 0, "administracion tampoco edita reservas directo (0 filas)"]);
});

//EXTRA
report(r);
