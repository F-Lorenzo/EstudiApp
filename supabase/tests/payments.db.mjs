// Migración 0011: cimientos del cobro (comisión, política de reembolsos, cola de reembolsos,
// credenciales de Mercado Pago y avisos idempotentes).
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { makeDb, as, ids, expectFail, expectOk, report } from "./harness.mjs";
import { seed } from "./seed.mjs";

const r = [];
const db = await makeDb();
await seed(db);
const q = (sql) => db.query(sql);
const S = (n) => `52000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const hintOf = async (who, fn) => {
  try { await as(db, who, fn); return null; } catch (e) { return e.hint ?? `sin hint: ${String(e.message).slice(0, 60)}`; }
};
const expectHint = async (label, who, fn, hint) => {
  const got = await hintOf(who, fn);
  r.push([got === hint, `${label}  → hint=${got}`]);
};

// --- 1. Política de reembolsos: la misma tabla de casos que usa el espejo en TypeScript ------------------
const CASOS = JSON.parse(fs.readFileSync(fileURLToPath(new URL("./fixtures/refund-policy-cases.json", import.meta.url)), "utf8"));
for (const c of CASOS) {
  const x = (await q(`select public.refund_percent(
      timestamptz '2026-12-01 15:00+00',
      timestamptz '2026-12-01 15:00+00' - (${c.minutesBefore} * interval '1 minute'),
      ${c.tutorOrAdmin}) as p`)).rows[0].p;
  r.push([x === c.percent, `refund_percent: ${c.caso} → ${x} %`]);
}

// --- 2. Comisión: tasa vigente y «foto» en cada reserva ------------------------------------------------------
{
  const x = (await q(`select public.commission_rate_for('${ids.docente}') as rate`)).rows[0].rate;
  r.push([Number(x) === 0.12, `la comisión de hoy es 12 % (${x})`]);
  const redondeos = (await q(`select public.booking_commission(10000, 0.12) as a, public.booking_commission(8333.33, 0.12) as b, public.booking_commission(1, 0.12) as c`)).rows[0];
  r.push([Number(redondeos.a) === 1200 && Number(redondeos.b) === 1000 && Number(redondeos.c) === 0.12, `booking_commission redondea a centavos (${redondeos.a}, ${redondeos.b}, ${redondeos.c})`]);
}

await db.exec(`
  insert into public.availability_slots (id, tutor_id, starts_at, ends_at) values
    ('${S(1)}', '${ids.docente}', now() + interval '5 days', now() + interval '5 days 1 hour'),
    ('${S(2)}', '${ids.docente}', now() + interval '6 days', now() + interval '6 days 1 hour'),
    ('${S(3)}', '${ids.docente}', now() + interval '7 days', now() + interval '7 days 1 hour'),
    ('${S(4)}', '${ids.docente}', now() + interval '8 days', now() + interval '8 days 1 hour');
`);
const book = async (who, slot) => as(db, who, async () => (await q(`select public.create_booking('${slot}') as id`)).rows[0].id);

const b1 = await book("alumno", S(1));
{
  const x = (await q(`select commission_rate from public.bookings where id = '${b1}'`)).rows[0];
  r.push([Number(x.commission_rate) === 0.12, "una reserva nueva guarda la comisión del momento (12 %)"]);
}

// La regla cambia más adelante: las reservas ya hechas NO cambian, las nuevas toman la nueva.
await db.exec(`create or replace function public.commission_rate_for(p_tutor uuid) returns numeric(5,4) language sql stable as $$ select 0.1000::numeric(5,4) $$`);
const b2 = await book("alumno", S(2));
{
  const x = (await q(`select id, commission_rate from public.bookings where id in ('${b1}', '${b2}')`)).rows;
  const rate = (id) => Number(x.find((y) => y.id === id).commission_rate);
  r.push([rate(b1) === 0.12 && rate(b2) === 0.1, `al cambiar la regla, la reserva vieja sigue en 12 % y la nueva toma ${rate(b2) * 100} %`]);
}
await db.exec(`create or replace function public.commission_rate_for(p_tutor uuid) returns numeric(5,4) language sql stable as $$ select 0.1200::numeric(5,4) $$`);
await db.exec(`update public.bookings set status = 'cancelada' where id = '${b2}'; update public.availability_slots set is_booked = false where id = '${S(2)}'`);

// --- 3. Confirmar el pago valida la comisión contra la foto de la reserva --------------------------------------
await expectHint("comisión distinta de la acordada: commission_mismatch", "service", () => q(`select public.confirm_booking_payment('${b1}', 'mp-1', 10000, 1000)`), "commission_mismatch");
await expectHint("comisión de 0: commission_mismatch (ya no se acepta cualquier valor)", "service", () => q(`select public.confirm_booking_payment('${b1}', 'mp-1', 10000, 0)`), "commission_mismatch");
await expectHint("monto distinto del precio: amount_mismatch", "service", () => q(`select public.confirm_booking_payment('${b1}', 'mp-1', 9000)`), "amount_mismatch");
await as(db, "service", () => expectOk("sin informar la comisión usa la de la reserva", q(`select public.confirm_booking_payment('${b1}', 'mp-1', 10000)`), r));
{
  const p = (await q(`select * from public.payments where booking_id = '${b1}'`)).rows[0];
  r.push([Number(p.amount) === 10000 && Number(p.commission_amount) === 1200 && Number(p.tutor_amount) === 8800 && Number(p.refunded_amount) === 0,
    `el pago queda con monto 10000, comisión 1200 y docente 8800 (${p.amount}, ${p.commission_amount}, ${p.tutor_amount})`]);
}
await as(db, "service", () => expectOk("repetir el mismo pago con la comisión correcta es idempotente", q(`select public.confirm_booking_payment('${b1}', 'mp-1', 10000, 1200)`), r));
await expectHint("el alumno NO puede confirmar un pago", "alumno", () => q(`select public.confirm_booking_payment('${b1}', 'mp-x', 10000)`), "sin hint: permission denied for function confirm_booking_payment");

// Una reserva paga todavía no se puede cancelar (hasta que exista el ejecutor de reembolsos, 0012).
await expectHint("cancelar una reserva paga sigue bloqueado hasta la 0012", "alumno", () => q(`select public.cancel_booking('${b1}')`), "refund_required");

// --- 4. Cola de reembolsos y su resultado --------------------------------------------------------------------------
const pago1 = (await q(`select id from public.payments where booking_id = '${b1}'`)).rows[0].id;
const nuevoReembolso = async (mpPayment, percent, amount, reason = "cancelacion_alumno") =>
  (await q(`insert into public.refunds (booking_id, payment_id, mercadopago_payment_id, percent, amount, reason)
            values ('${b1}', '${pago1}', '${mpPayment}', ${percent}, ${amount}, '${reason}') returning id`)).rows[0].id;

const ref = await as(db, "service", () => nuevoReembolso("mp-1", 50, 5000));
{
  const x = (await q(`select status, attempts, idempotency_key from public.refunds where id = '${ref}'`)).rows[0];
  r.push([x.status === "pendiente" && x.attempts === 0 && !!x.idempotency_key, "un reembolso nuevo queda «pendiente» con su clave de idempotencia"]);
}
await as(db, "service", () => expectFail("un pago se reembolsa una sola vez (mercadopago_payment_id único)", nuevoReembolso("mp-1", 100, 10000), r));
await as(db, "service", () => expectFail("no se registra un reembolso de monto 0", nuevoReembolso("mp-cero", 0, 0), r));

await as(db, "service", () => expectOk("un intento falla: queda «fallido» y se puede reintentar", q(`select public.mark_refund_result('${ref}', 'fallido', null, 'timeout de Mercado Pago')`), r));
{
  const x = (await q(`select status, attempts, failure_detail from public.refunds where id = '${ref}'`)).rows[0];
  r.push([x.status === "fallido" && x.attempts === 1 && /timeout/.test(x.failure_detail), `queda fallido con 1 intento y el detalle (${x.status}, ${x.attempts})`]);
}
await as(db, "service", () => expectOk("el reintento sale bien: reembolso parcial del 50 %", q(`select public.mark_refund_result('${ref}', 'aprobado', 'mp-refund-1')`), r));
{
  const p = (await q(`select status, amount, refunded_amount, commission_amount, tutor_amount from public.payments where id = '${pago1}'`)).rows[0];
  r.push([Number(p.refunded_amount) === 5000 && Number(p.commission_amount) === 600 && Number(p.tutor_amount) === 4400 && p.status === "aprobado",
    `devuelto 5000: la comisión y el docente se recalculan sobre lo retenido (comisión ${p.commission_amount}, docente ${p.tutor_amount}, estado ${p.status})`]);
}
await as(db, "service", () => expectOk("repetir el resultado aprobado es idempotente", q(`select public.mark_refund_result('${ref}', 'aprobado', 'mp-refund-1')`), r));
{
  const p = (await q(`select refunded_amount, commission_amount from public.payments where id = '${pago1}'`)).rows[0];
  const x = (await q(`select attempts from public.refunds where id = '${ref}'`)).rows[0];
  r.push([Number(p.refunded_amount) === 5000 && Number(p.commission_amount) === 600 && x.attempts === 2, "...y no devuelve dos veces (refunded_amount sigue en 5000)"]);
}
await expectHint("no se puede dejar un reembolso en «pendiente»", "service", () => q(`select public.mark_refund_result('${ref}', 'pendiente')`), "invalid_status");
await expectHint("un reembolso inexistente", "service", () => q(`select public.mark_refund_result('99999999-9999-9999-9999-999999999999', 'aprobado')`), "not_found");

// Reembolso total de otra reserva: el pago pasa a «reembolsado».
const b3 = await book("alumno2", S(3));
await as(db, "service", () => q(`select public.confirm_booking_payment('${b3}', 'mp-3', 10000)`));
const pago3 = (await q(`select id from public.payments where booking_id = '${b3}'`)).rows[0].id;
const ref3 = (await q(`insert into public.refunds (booking_id, payment_id, mercadopago_payment_id, percent, amount, reason)
  values ('${b3}', '${pago3}', 'mp-3', 100, 10000, 'cancelacion_docente') returning id`)).rows[0].id;
await as(db, "service", () => q(`select public.mark_refund_result('${ref3}', 'aprobado', 'mp-refund-3')`));
{
  const p = (await q(`select status, refunded_amount, commission_amount, tutor_amount from public.payments where id = '${pago3}'`)).rows[0];
  r.push([p.status === "reembolsado" && Number(p.refunded_amount) === 10000 && Number(p.commission_amount) === 0 && Number(p.tutor_amount) === 0,
    `reembolso total: el pago queda «reembolsado» sin comisión ni docente (${p.status}, ${p.commission_amount}, ${p.tutor_amount})`]);
}
// Un pago aprobado que no se pudo aceptar no tiene fila en payments: el reembolso se hace igual.
await as(db, "service", () => expectOk("un reembolso de un pago que nunca se aceptó (sin booking ni payment)", q(
  `insert into public.refunds (mercadopago_payment_id, percent, amount, reason) values ('mp-huerfano', 100, 8000, 'pago_tardio')`), r));

// --- 5. Quién ve y quién escribe los reembolsos ----------------------------------------------------------------
await as(db, "alumno", async () => {
  const x = await q(`select id from public.refunds where id = '${ref}'`);
  r.push([x.rows.length === 1, "el alumno ve el reembolso de su reserva"]);
});
await as(db, "docente", async () => {
  const x = await q(`select id from public.refunds where id = '${ref}'`);
  r.push([x.rows.length === 1, "el docente ve el reembolso de su clase"]);
});
await as(db, "alumno2", async () => {
  const x = await q(`select id from public.refunds where id = '${ref}'`);
  r.push([x.rows.length === 0, "otro alumno NO ve reembolsos ajenos"]);
});
await as(db, "anon", () => expectFail("un visitante NO lee reembolsos", q(`select * from public.refunds`), r));
await as(db, "alumno", () => expectFail("el alumno NO puede crearse un reembolso", q(`insert into public.refunds (mercadopago_payment_id, percent, amount, reason) values ('mp-falso', 100, 1, 'x')`), r));
await as(db, "alumno", () => expectFail("el alumno NO puede editar un reembolso", q(`update public.refunds set amount = 1 where id = '${ref}'`), r));
await as(db, "admin", () => expectFail("ni la administración edita reembolsos desde la API", q(`update public.refunds set status = 'aprobado' where id = '${ref}'`), r));
await expectHint("el alumno NO ejecuta mark_refund_result", "alumno", () => q(`select public.mark_refund_result('${ref}', 'aprobado')`), "sin hint: permission denied for function mark_refund_result");
await expectHint("un visitante NO ejecuta begin_payment_event", "anon", () => q(`select public.begin_payment_event('x', '{}')`), "sin hint: permission denied for function begin_payment_event");
await expectHint("el docente NO ejecuta finish_payment_event", "docente", () => q(`select public.finish_payment_event('x')`), "sin hint: permission denied for function finish_payment_event");

// --- 6. Avisos (webhooks) idempotentes ------------------------------------------------------------------------------
await as(db, "service", async () => {
  const llega = async (id) => (await q(`select public.begin_payment_event('${id}', '{"type":"payment","data":{"id":"123"}}') as v`)).rows[0].v;
  r.push([(await llega("evt-1")) === "nuevo", "el primer aviso es «nuevo»"]);
  r.push([(await llega("evt-1")) === "reintento", "si llega otra vez sin haberse procesado es «reintento» (hay que procesarlo)"]);
  await q(`select public.finish_payment_event('evt-1', 'Mercado Pago no respondió')`);
  r.push([(await llega("evt-1")) === "reintento", "si falló el procesamiento sigue siendo «reintento»"]);
  await q(`select public.finish_payment_event('evt-1')`);
  r.push([(await llega("evt-1")) === "duplicado", "una vez procesado, el mismo aviso es «duplicado» (se responde 200 y no se repite)"]);
  const e = (await q(`select processed_at, process_error, attempts from public.payment_webhook_events where mercadopago_event_id = 'evt-1'`)).rows[0];
  r.push([!!e.processed_at && e.attempts === 2, `el aviso queda marcado como procesado tras 2 intentos (${e.attempts})`]);
});

// --- 7. Credenciales de Mercado Pago: solo la service role ------------------------------------------------------------
await as(db, "service", () => expectOk("el backend guarda las credenciales de un docente", q(
  `insert into public.mp_credentials (tutor_id, mp_user_id, access_token, refresh_token, expires_at)
   values ('${ids.docente}', '555', 'cifrado-a', 'cifrado-r', now() + interval '180 days')`), r));
await as(db, "docente", () => expectFail("el docente NO puede leer SUS PROPIOS tokens", q(`select * from public.mp_credentials`), r));
await as(db, "docente", () => expectFail("el docente NO puede escribir tokens", q(`update public.mp_credentials set access_token = 'x'`), r));
await as(db, "docente2", () => expectFail("otro docente NO puede crear credenciales", q(
  `insert into public.mp_credentials (tutor_id, mp_user_id, access_token, refresh_token, expires_at) values ('${ids.docente2}', '666', 'a', 'r', now())`), r));
await as(db, "admin", () => expectFail("ni la administración lee los tokens desde la API", q(`select * from public.mp_credentials`), r));
await as(db, "anon", () => expectFail("un visitante NO lee tokens", q(`select * from public.mp_credentials`), r));
await as(db, "service", () => expectFail("un usuario de Mercado Pago no puede estar vinculado a dos docentes", q(
  `insert into public.mp_credentials (tutor_id, mp_user_id, access_token, refresh_token, expires_at) values ('${ids.docente2}', '555', 'a', 'r', now())`), r));

report(r);
