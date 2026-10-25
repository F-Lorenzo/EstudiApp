// Migración 0015: la bandeja de emails. La base solo anota QUÉ hay que avisar y a quién (en la misma transacción
// que el hecho), el servidor reclama las filas, las envía y anota el resultado. Se prueba cada trigger, la
// idempotencia, que un problema con el email NUNCA rompa la operación principal, el reclamo con reintentos
// espaciados, el resultado idempotente y que la bandeja sea solo del backend.
import { makeDb, as, ids, report, track } from "./harness.mjs";
import { seed, linkPayoutAccount } from "./seed.mjs";
import { makeBookingHelpers } from "./booking-helpers.mjs";

const r = track([]);
const db = await makeDb();
await seed(db);
const q = (sql) => db.query(sql);
const { reservaSinPagar, reservaPaga, cancelarA } = makeBookingHelpers(db, { slotPrefix: "56000000" });
const EMAILS = ["alumno@ejemplo.test", "alumno2@ejemplo.test", "docente@ejemplo.test", "docente2@ejemplo.test", "admin@ejemplo.test"];
const NOEXISTE = "99999999-9999-9999-9999-999999999999";

const canon = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
const es = (label, got, want) => r.push([canon(got) === canon(want), `${label} → ${JSON.stringify(got)}`]);
const hintDe = async (who, sql) => {
  try { await as(db, who, () => q(sql)); return null; } catch (e) { return e.hint ?? `sin hint: ${String(e.message).slice(0, 60)}`; }
};
const expectHint = async (label, who, sql, hint) => {
  const got = await hintDe(who, sql);
  r.push([got === hint, `${label}  → hint=${got}`]);
};
// Para las pruebas que cambian la base «a mano» (como el SQL Editor): sin una sesión de la API de por medio.
const sinSesion = () => db.exec("select set_config('request.jwt.claim.sub', '', false)");
const sinPermiso = async (label, who, sql) => {
  const got = await hintDe(who, sql);
  r.push([typeof got === "string" && got.startsWith("sin hint: permission denied"), `${label}  → ${got}`]);
};

const total = async () => Number((await q(`select count(*)::int as n from public.email_outbox`)).rows[0].n);
/** Los emails de una reserva: { "<kind>:<destinatario>": fila }. */
const bandeja = async (booking) =>
  Object.fromEntries(
    (await q(`select * from public.email_outbox where booking_id = '${booking}'`)).rows.map((x) => [`${x.kind}:${Object.keys(ids).find((k) => ids[k] === x.recipient_id)}`, x]),
  );
const claves = async (booking) => Object.keys(await bandeja(booking)).sort();

// =================================================================================================================
// 1. Reserva confirmada → un email al alumno y otro al docente
// =================================================================================================================
const A = await reservaPaga();
{
  const b = await bandeja(A.booking);
  es("al confirmarse el pago se anotan DOS emails", Object.keys(b).sort(), ["nueva_reserva_docente:docente", "reserva_confirmada:alumno"]);
  const al = b["reserva_confirmada:alumno"];
  const dc = b["nueva_reserva_docente:docente"];
  r.push([al.status === "pendiente" && al.attempts === 0 && al.sent_at === null && al.last_attempt_at === null && al.last_error === null && al.booking_id === A.booking, "quedan pendientes, sin intentos ni envío"]);
  const p = al.payload;
  r.push([p.student_name === "alumno a1" && p.tutor_name === "docente d1" && p.subject === "Matemática" && Number(p.price) === 10000 && Number(p.amount_paid) === 10000, "el email del alumno lleva nombres, materia, precio y el monto pagado"]);
  const hora = (await q(`select starts_at, ends_at from public.bookings where id = '${A.booking}'`)).rows[0];
  r.push([new Date(p.starts_at).getTime() === hora.starts_at.getTime() && new Date(p.ends_at).getTime() === hora.ends_at.getTime(), "...y el horario de la clase"]);
  r.push([!("tutor_amount" in p), "...sin lo que cobra el docente"]);
  const d = dc.payload;
  r.push([Number(d.amount_paid) === 10000 && Number(d.tutor_amount) === 8800 && d.student_name === "alumno a1" && d.tutor_name === "docente d1", "el del docente lleva además lo que va a cobrar (10000 menos 12 % = 8800)"]);
}
// Repetir el pago (idempotente) no duplica nada.
await as(db, "service", () => q(`select public.confirm_booking_payment('${A.booking}', '${A.mp}', 10000)`));
es("confirmar el mismo pago otra vez no anota más emails", await claves(A.booking), ["nueva_reserva_docente:docente", "reserva_confirmada:alumno"]);

// La materia solo va si el docente da UNA; con dos no se adivina cuál es.
{
  await db.exec(`update public.tutor_profiles set verification_status = 'aprobado', tarifa_por_clase = 9000 where id = '${ids.docente2}'`);
  await linkPayoutAccount(db, ids.docente2, "seed-mp-d2");
  const uno = await reservaPaga({ tutor: "docente2", price: 9000 });
  es("un docente con una sola materia: va en el email", (await bandeja(uno.booking))["reserva_confirmada:alumno"].payload.subject, "Física");
  await db.exec(`insert into public.tutor_subjects (tutor_id, subject_id) select '${ids.docente2}', id from public.subjects where name = 'Química'`);
  const dos = await reservaPaga({ tutor: "docente2", price: 9000 });
  es("con dos materias, el email no inventa una", "subject" in (await bandeja(dos.booking))["reserva_confirmada:alumno"].payload, false);
}

// =================================================================================================================
// 2. Idempotencia: disparar el trigger otra vez no duplica ni pisa
// =================================================================================================================
{
  const antes = await bandeja(A.booking);
  await db.exec(`update public.profiles set full_name = 'Nombre Nuevo' where id = '${ids.alumno}'`);
  await db.exec(`update public.bookings set status = 'pendiente_pago' where id = '${A.booking}'`);
  await db.exec(`update public.bookings set status = 'confirmada' where id = '${A.booking}'`); // el trigger vuelve a correr
  const despues = await bandeja(A.booking);
  es("disparar la confirmación otra vez no duplica los emails", Object.keys(despues).sort(), Object.keys(antes).sort());
  r.push([despues["reserva_confirmada:alumno"].id === antes["reserva_confirmada:alumno"].id && despues["reserva_confirmada:alumno"].payload.student_name === "alumno a1",
    "...ni pisa la foto que ya estaba (sigue con el nombre de ese momento)"]);
  await db.exec(`update public.profiles set full_name = 'alumno a1' where id = '${ids.alumno}'`);

  // Si faltaba solo UNO de los dos, el otro se anota y el que estaba no se duplica.
  await db.exec(`delete from public.email_outbox where booking_id = '${A.booking}' and kind = 'nueva_reserva_docente'`);
  await db.exec(`update public.bookings set status = 'pendiente_pago' where id = '${A.booking}'`);
  await db.exec(`update public.bookings set status = 'confirmada' where id = '${A.booking}'`);
  es("si faltaba uno de los dos, se repone sin duplicar el otro", await claves(A.booking), ["nueva_reserva_docente:docente", "reserva_confirmada:alumno"]);

  // La restricción única es lo que lo garantiza.
  try {
    await db.exec(`insert into public.email_outbox (kind, booking_id, recipient_id) values ('reserva_confirmada', '${A.booking}', '${ids.alumno}')`);
    r.push([false, "un duplicado a mano debería rechazarse"]);
  } catch (e) {
    r.push([e.code === "23505", "un mismo aviso de la misma reserva a la misma persona no se puede anotar dos veces (restricción única)"]);
  }
  await db.exec(`insert into public.email_outbox (kind, booking_id, recipient_id) values ('otro_aviso', '${A.booking}', '${ids.alumno}')`);
  r.push([true, "...pero otro tipo de aviso de la misma reserva sí"]);
  await db.exec(`delete from public.email_outbox where kind = 'otro_aviso'`);
}

// =================================================================================================================
// 3. Se cancela una reserva paga → un email a cada parte
// =================================================================================================================
{
  // El alumno, con 3 días de anticipación: 100 %.
  const c = await reservaPaga();
  const { result: x } = await cancelarA(c.booking, "alumno", 4320);
  const b = await bandeja(c.booking);
  es("cancelar una reserva paga anota los emails de cancelación", Object.keys(b).sort(),
    ["nueva_reserva_docente:docente", "reserva_cancelada:alumno", "reserva_cancelada:docente", "reserva_confirmada:alumno"]);
  const al = b["reserva_cancelada:alumno"].payload;
  r.push([al.cancelled_by === "alumno" && al.refund_percent === 100 && Number(al.refund_amount) === 10000 && Number(al.amount_paid) === 10000 && al.reason === "Cancelada por el alumno",
    `al alumno: quién canceló, el reembolso que le corresponde (100 %, 10000), lo que pagó y el motivo (${al.refund_percent} %, ${al.refund_amount})`]);
  const dc = b["reserva_cancelada:docente"].payload;
  r.push([dc.cancelled_by === "alumno" && dc.reason === "Cancelada por el alumno" && !("refund_percent" in dc) && !("refund_amount" in dc) && !("amount_paid" in dc),
    "al docente: quién canceló y el motivo, sin datos de plata del alumno"]);
  r.push([b["reserva_cancelada:alumno"].status === "pendiente" && x.refund !== null, "...pendientes de enviar"]);

  // Con menos de 24 h: 50 %. Con menos de 2 h: 0 %.
  const m = await reservaPaga();
  await cancelarA(m.booking, "alumno", 720);
  const pm = (await bandeja(m.booking))["reserva_cancelada:alumno"].payload;
  r.push([pm.refund_percent === 50 && Number(pm.refund_amount) === 5000, `con 12 h de anticipación el email dice 50 % (${pm.refund_percent} %, ${pm.refund_amount})`]);
  const z = await reservaPaga();
  await cancelarA(z.booking, "alumno", 30);
  const pz = (await bandeja(z.booking))["reserva_cancelada:alumno"].payload;
  r.push([pz.refund_percent === 0 && Number(pz.refund_amount) === 0 && Number(pz.amount_paid) === 10000, `con 30 minutos el email dice 0 % pero aclara cuánto pagó (${pz.refund_percent} %, ${pz.refund_amount})`]);

  // El docente: siempre 100 %.
  const d = await reservaPaga();
  await cancelarA(d.booking, "docente", 30, "Me enfermé");
  const pd = (await bandeja(d.booking));
  r.push([pd["reserva_cancelada:alumno"].payload.cancelled_by === "docente" && pd["reserva_cancelada:alumno"].payload.refund_percent === 100 &&
    pd["reserva_cancelada:alumno"].payload.reason === "Me enfermé" && pd["reserva_cancelada:docente"].payload.reason === "Me enfermé",
    "cancela el docente: el alumno ve «cancelled_by: docente», el 100 % y el motivo que escribió"]);
  // La administración.
  const ad = await reservaPaga();
  await cancelarA(ad.booking, "admin", 4320);
  r.push([(await bandeja(ad.booking))["reserva_cancelada:alumno"].payload.cancelled_by === "administracion", "cancela la administración: cancelled_by = administracion"]);
  // Sin sesión de alumno ni de docente (por ejemplo, desde el SQL Editor): cuenta como la administración y no inventa un reembolso.
  const se = await reservaPaga();
  await sinSesion();
  await db.exec(`update public.bookings set status = 'cancelada' where id = '${se.booking}'`);
  const ps = (await bandeja(se.booking))["reserva_cancelada:alumno"].payload;
  r.push([ps.cancelled_by === "administracion" && ps.refund_percent === 0 && Number(ps.refund_amount) === 0, "cancelada a mano en la base: administracion y sin reembolso encolado"]);

  // Una segunda cancelación no cambia nada.
  const antes = await total();
  await expectHint("cancelar dos veces", "alumno", `select public.cancel_booking('${c.booking}')`, "not_cancellable");
  es("...no anota más emails", await total(), antes);
  await db.exec(`update public.bookings set status = 'confirmada' where id = '${c.booking}'`);
  await db.exec(`update public.bookings set status = 'cancelada' where id = '${c.booking}'`);
  es("volver a disparar la cancelación no duplica", (await claves(c.booking)).filter((k) => k.startsWith("reserva_cancelada")), ["reserva_cancelada:alumno", "reserva_cancelada:docente"]);
}

// =================================================================================================================
// 4. Se aprueba un reembolso → un email al alumno
// =================================================================================================================
{
  const c = await reservaPaga();
  const { result: x } = await cancelarA(c.booking, "alumno", 4320);
  const sin = (await claves(c.booking)).filter((k) => k.startsWith("reembolso"));
  es("mientras el reembolso está pendiente no hay email de «reembolso realizado»", sin, []);
  await as(db, "service", () => q(`select public.mark_refund_result('${x.refund.id}', 'fallido', null, 'sin respuesta')`));
  es("un intento fallido tampoco lo anota", (await claves(c.booking)).filter((k) => k.startsWith("reembolso")), []);
  await as(db, "service", () => q(`select public.mark_refund_result('${x.refund.id}', 'aprobado', 'mp-ref-1')`));
  const e = (await bandeja(c.booking))["reembolso_realizado:alumno"];
  r.push([!!e && e.status === "pendiente" && e.payload.reason === "cancelacion" && Number(e.payload.refund_amount) === 10000 && e.payload.refund_percent === 100 &&
    e.payload.student_name === "alumno a1" && e.payload.tutor_name === "docente d1" && e.recipient_id === ids.alumno,
    "al aprobarse el reembolso se le avisa al alumno: motivo «cancelacion», monto y porcentaje"]);
  await as(db, "service", () => q(`select public.mark_refund_result('${x.refund.id}', 'aprobado', 'mp-ref-1')`));
  es("marcar aprobado otra vez no duplica", (await claves(c.booking)).filter((k) => k.startsWith("reembolso")), ["reembolso_realizado:alumno"]);
  await db.exec(`update public.refunds set status = 'pendiente' where id = '${x.refund.id}'`);
  await db.exec(`update public.refunds set status = 'aprobado' where id = '${x.refund.id}'`);
  es("...ni siquiera disparando el trigger de nuevo", (await claves(c.booking)).filter((k) => k.startsWith("reembolso")), ["reembolso_realizado:alumno"]);

  // Reembolso parcial.
  const p = await reservaPaga();
  const { result: y } = await cancelarA(p.booking, "alumno", 720);
  await as(db, "service", () => q(`select public.mark_refund_result('${y.refund.id}', 'aprobado', 'mp-ref-2')`));
  const ep = (await bandeja(p.booking))["reembolso_realizado:alumno"].payload;
  r.push([ep.refund_percent === 50 && Number(ep.refund_amount) === 5000, `un reembolso parcial dice 50 % y 5000 (${ep.refund_percent} %, ${ep.refund_amount})`]);

  // Un pago que no se pudo aceptar y se devolvió solo (reserva pendiente cuya retención venció).
  const { booking: t } = await reservaSinPagar();
  await db.exec(`update public.bookings set created_at = now() - interval '20 minutes' where id = '${t}'`);
  const aviso = await as(db, "service", async () =>
    (await q(`select public.apply_payment_notification('mp-tardio-e', '${t}', 'approved', 10000, 'ARS', 'seed-mp-d1', 0) as v`)).rows[0].v);
  es("un pago tardío se manda a reembolsar", aviso.outcome, "reembolso_encolado");
  es("...y por ahora no hay ningún email de esa reserva", await claves(t), []);
  await as(db, "service", () => q(`select public.mark_refund_result('${aviso.refund.id}', 'aprobado', 'mp-ref-3')`));
  const et = (await bandeja(t))["reembolso_realizado:alumno"];
  r.push([!!et && et.payload.reason === "pago_no_aceptable" && Number(et.payload.refund_amount) === 10000 && et.payload.refund_percent === 100,
    "al devolverse un pago que no se pudo aceptar el email dice «pago_no_aceptable» y el monto"]);
  es("...y es lo único que se anota de esa reserva (nunca estuvo confirmada)", await claves(t), ["reembolso_realizado:alumno"]);

  // Un reembolso sin reserva (pago de una reserva inexistente) no tiene a quién avisar.
  const antes = await total();
  const h = await as(db, "service", async () =>
    (await q(`select public.apply_payment_notification('mp-huerfano-e', '${NOEXISTE}', 'approved', 7000, 'ARS', 'seed-mp-d1', 0) as v`)).rows[0].v);
  await as(db, "service", () => q(`select public.mark_refund_result('${h.refund.id}', 'aprobado', 'mp-ref-4')`));
  es("un reembolso sin reserva no anota ningún email", await total(), antes);
}

// =================================================================================================================
// 5. Las reservas sin pago no generan emails
// =================================================================================================================
{
  const antes = await total();
  const a = await reservaSinPagar();
  await as(db, "alumno", () => q(`select public.cancel_booking('${a.booking}')`));
  const b = await reservaSinPagar();
  await as(db, "docente", () => q(`select public.cancel_booking('${b.booking}')`));
  const c = await reservaSinPagar();
  await as(db, "admin", () => q(`select public.cancel_booking('${c.booking}')`));
  const d = await reservaSinPagar();
  await db.exec(`update public.bookings set created_at = now() - interval '20 minutes' where id = '${d.booking}'`);
  await as(db, "alumno", () => q(`select public.sync_bookings()`));
  r.push([(await q(`select status from public.bookings where id = '${d.booking}'`)).rows[0].status === "cancelada", "(una reserva sin pagar venció)"]);
  es("cancelar o vencer reservas SIN pago no anota ningún email", await total(), antes);

  // Una clase confirmada que termina pasa a «completada»: no es un hecho para avisar. (Sin asistencia registrada,
  // sync_bookings la completa 3 días después de terminar, migración 0017.)
  const e = await reservaPaga();
  const despuesDeConfirmar = await total();
  await db.exec(`update public.bookings set starts_at = now() - interval '4 days 1 hour', ends_at = now() - interval '4 days' where id = '${e.booking}'`);
  await as(db, "alumno", () => q(`select public.sync_bookings()`));
  r.push([(await q(`select status from public.bookings where id = '${e.booking}'`)).rows[0].status === "completada" && (await total()) === despuesDeConfirmar, "completarse una clase no anota emails"]);
}

// =================================================================================================================
// 6. Un problema con el email NUNCA rompe la operación principal
// =================================================================================================================
{
  await db.exec(`alter table public.email_outbox add constraint email_prohibido check (false) not valid`);
  const antes = await total();
  const a = await reservaPaga(); // confirm_booking_payment termina bien aunque no pueda anotar los emails
  const estado = (await q(`select b.status, p.status as pago from public.bookings b join public.payments p on p.booking_id = b.id where b.id = '${a.booking}'`)).rows[0];
  r.push([estado.status === "confirmada" && estado.pago === "aprobado", "con la bandeja rota, el pago igual confirma la reserva"]);
  const { result: x, error } = await cancelarA(a.booking, "alumno", 4320);
  r.push([!error && x.percent === 100 && x.refund !== null && (await q(`select status from public.bookings where id = '${a.booking}'`)).rows[0].status === "cancelada", "...la cancelación igual se hace y encola el reembolso"]);
  await as(db, "service", () => q(`select public.mark_refund_result('${x.refund.id}', 'aprobado', 'mp-ref-5')`));
  const pago = (await q(`select status, refunded_amount from public.payments where id = '${a.payment}'`)).rows[0];
  r.push([pago.status === "reembolsado" && Number(pago.refunded_amount) === 10000, "...y el reembolso igual se registra"]);
  es("...sin dejar emails a medias", await total(), antes);
  await db.exec(`alter table public.email_outbox drop constraint email_prohibido`);
  const b = await reservaPaga();
  es("arreglada la bandeja, vuelven a anotarse", (await claves(b.booking)).length, 2);
}

// Ningún payload lleva el email de nadie (ni ningún «@»).
async function sinEmailsEnPayloads(cuando) {
  const todos = (await q(`select payload::text as t from public.email_outbox`)).rows.map((x) => x.t);
  const filtrado = todos.filter((t) => t.includes("@") || EMAILS.some((e) => t.includes(e)));
  r.push([todos.length > 0 && filtrado.length === 0, `ningún payload contiene un email (${todos.length} revisados, ${cuando})`]);
}
await sinEmailsEnPayloads("después de los triggers");

// =================================================================================================================
// 7. claim_pending_emails
// =================================================================================================================
await db.exec(`delete from public.email_outbox`);
const fila = (kind, { status = "pendiente", attempts = 0, creado = "10 minutes", ultimo = null, destino = "alumno", payload = "{}" } = {}) =>
  `insert into public.email_outbox (kind, recipient_id, status, attempts, last_attempt_at, created_at, payload)
   values ('${kind}', '${ids[destino]}', '${status}', ${attempts}, ${ultimo ? `now() - interval '${ultimo}'` : "null"}, now() - interval '${creado}', '${payload}')`;
const reclamar = (limit = "") => as(db, "service", async () => (await q(`select public.claim_pending_emails(${limit}) as v`)).rows[0].v);
const fila1 = async (kind) => (await q(`select * from public.email_outbox where kind = '${kind}'`)).rows[0];
{
  await db.exec([
    fila("c1", { creado: "60 minutes", payload: '{"hola":"c1"}' }),
    fila("c2", { creado: "50 minutes", destino: "docente" }),
    fila("c3", { creado: "40 minutes", status: "fallido", attempts: 2, ultimo: "10 minutes", destino: "alumno2" }),
    fila("c4-espera", { creado: "35 minutes", status: "fallido", attempts: 2, ultimo: "1 minute" }),
    fila("c5-agotado", { creado: "30 minutes", attempts: 5, ultimo: "1 hour" }),
    fila("c6-ultimo-intento", { creado: "21 minutes", attempts: 4, ultimo: "6 minutes", destino: "docente2" }),
    fila("c7-enviado", { creado: "25 minutes", status: "enviado" }),
    fila("c8-omitido", { creado: "24 minutes", status: "omitido" }),
    fila("c9-hace-6-min", { creado: "19 minutes", status: "fallido", attempts: 1, ultimo: "6 minutes" }),
    fila("c10-hace-4-min", { creado: "18 minutes", status: "fallido", attempts: 1, ultimo: "4 minutes" }),
  ].join(";\n"));

  const primera = await reclamar("3");
  r.push([primera.map((x) => x.kind).join(",") === "c1,c2,c3", `reclama hasta el límite (3), los más viejos primero (${primera.map((x) => x.kind).join(", ")})`]);
  const c1 = primera[0];
  r.push([JSON.stringify(Object.keys(c1).sort()) === JSON.stringify(["attempts", "id", "kind", "payload", "to_email", "to_name"]), `cada elemento trae id, kind, attempts, to_email, to_name y payload (${Object.keys(c1).sort().join(", ")})`]);
  r.push([c1.to_email === "alumno@ejemplo.test" && c1.to_name === "alumno a1" && c1.payload.hola === "c1", "el email y el nombre salen de la cuenta del destinatario; el payload va tal cual"]);
  es("attempts es el intento que se hace ahora (0 → 1, 2 → 3)", [primera[0].attempts, primera[2].attempts], [1, 3]);
  const guardado = await fila1("c1");
  r.push([guardado.attempts === 1 && guardado.last_attempt_at !== null && guardado.status === "pendiente" && guardado.sent_at === null, "al reclamar suma un intento y anota la hora; sigue pendiente hasta que se anote el resultado"]);
  es("reclamar otra vez enseguida no devuelve las mismas", (await reclamar("3")).map((x) => x.kind), ["c6-ultimo-intento", "c9-hace-6-min"]);
  r.push([(await fila1("c6-ultimo-intento")).attempts === 5, "con 4 intentos todavía se reclama (es el quinto)"]);
  es("...y ya nadie reclama los que esperan, los agotados, los enviados ni los omitidos", await reclamar(), []);
  r.push([(await fila1("c4-espera")).attempts === 2 && (await fila1("c5-agotado")).attempts === 5 && (await fila1("c10-hace-4-min")).attempts === 1, "...sin tocarles los intentos"]);

  // Pasados 5 minutos vuelven, con un intento más; al llegar a 5 no vuelven más.
  await db.exec(`update public.email_outbox set last_attempt_at = now() - interval '6 minutes' where kind = 'c1'`);
  const otra = await reclamar();
  r.push([otra.length === 1 && otra[0].kind === "c1" && otra[0].attempts === 2, "pasados los 5 minutos vuelve a reclamarse, con un intento más (el de hace 4 minutos todavía espera)"]);
  for (const n of [3, 4]) {
    await db.exec(`update public.email_outbox set last_attempt_at = now() - interval '6 minutes' where kind = 'c1'`);
    const x = await reclamar();
    r.push([x.some((y) => y.kind === "c1" && y.attempts === n), `...intento ${n}`]);
  }
  await db.exec(`update public.email_outbox set last_attempt_at = now() - interval '6 minutes' where kind = 'c1'`);
  const quinto = await reclamar();
  r.push([quinto.some((y) => y.kind === "c1" && y.attempts === 5), "...intento 5 (el último)"]);
  await db.exec(`update public.email_outbox set last_attempt_at = now() - interval '1 day' where kind = 'c1'`);
  es("con 5 intentos no vuelve más, por mucho que pase", (await reclamar()).filter((y) => y.kind === "c1"), []);
  r.push([(await fila1("c1")).attempts === 5, "...y no suma otro intento"]);

  // Límite 0 y sin límite.
  await db.exec(`delete from public.email_outbox`);
  await db.exec([fila("l1"), fila("l2", { destino: "docente" })].join(";\n"));
  es("con límite 0 no reclama nada", await reclamar("0"), []);
  r.push([(await fila1("l1")).attempts === 0, "...y no suma intentos"]);
  es("sin límite (null) usa el predeterminado", (await reclamar("null")).length, 2);
}

// Destinatarios sin email: se omiten y no se devuelven.
{
  await db.exec(`delete from public.email_outbox`);
  await db.exec(`update auth.users set email = null where id = '${ids.admin}'; update auth.users set email = '   ' where id = '${ids.alumno2}'`);
  await db.exec([fila("s1", { destino: "admin", creado: "12 minutes" }), fila("s2", { destino: "alumno2", creado: "11 minutes" }), fila("s3", { destino: "alumno" }), fila("s4-viejo", { destino: "admin", attempts: 5, creado: "9 minutes" })].join(";\n"));
  const x = await reclamar();
  es("solo se devuelve a quien tiene email", x.map((y) => y.kind), ["s3"]);
  const s1 = await fila1("s1");
  const s2 = await fila1("s2");
  r.push([s1.status === "omitido" && s2.status === "omitido" && s1.attempts === 0 && /email/i.test(s1.last_error ?? ""), "...y las de quien no tiene email (nulo o en blanco) pasan a «omitido» con el motivo, sin intentos"]);
  es("una fila ya agotada no se toca", (await fila1("s4-viejo")).status, "pendiente");
  es("las omitidas no se reclaman nunca más", await reclamar(), []);
  await db.exec(`update auth.users set email = 'admin@ejemplo.test' where id = '${ids.admin}'; update auth.users set email = 'alumno2@ejemplo.test' where id = '${ids.alumno2}'`);
  es("aunque después la persona tenga email, «omitido» es definitivo", await reclamar(), []);
}
{
  const fuente = (await q(`select prosrc from pg_proc where proname = 'claim_pending_emails' and pronamespace = 'public'::regnamespace`)).rows[0].prosrc;
  r.push([/for update of o skip locked/i.test(fuente), "claim_pending_emails reclama con «for update skip locked» (dos procesos no toman la misma fila)"]);
}

// =================================================================================================================
// 8. mark_email_result
// =================================================================================================================
{
  await db.exec(`delete from public.email_outbox`);
  await db.exec([fila("m1"), fila("m2"), fila("m3"), fila("m4"), fila("m5")].join(";\n"));
  const ids5 = Object.fromEntries((await q(`select kind, id from public.email_outbox`)).rows.map((x) => [x.kind, x.id]));
  const marcar = (kind, estado, error = null) =>
    as(db, "service", () => q(`select public.mark_email_result('${ids5[kind]}', ${estado === null ? "null" : `'${estado}'`}, ${error === null ? "null" : `'${error.replace(/'/g, "''")}'`})`));
  await reclamar();

  // enviado
  await marcar("m1", "enviado");
  const m1 = await fila1("m1");
  r.push([m1.status === "enviado" && m1.sent_at !== null && m1.last_error === null, "enviado: queda con la hora de envío"]);
  await new Promise((resolve) => setTimeout(resolve, 20));
  await marcar("m1", "enviado");
  r.push([(await fila1("m1")).sent_at.getTime() === m1.sent_at.getTime(), "marcar «enviado» otra vez no cambia la hora (idempotente)"]);
  await marcar("m1", "fallido", "llegó tarde la respuesta");
  const m1b = await fila1("m1");
  r.push([m1b.status === "enviado" && m1b.last_error === null && m1b.sent_at.getTime() === m1.sent_at.getTime(), "una fila ya enviada NO vuelve atrás (un «fallido» tardío no la pisa)"]);
  await marcar("m1", "omitido");
  es("...ni a «omitido»", (await fila1("m1")).status, "enviado");

  // fallido (con datos personales en el detalle) y su recuperación.
  await marcar("m2", "fallido", "El proveedor rechazó a maria.gonzalez@ejemplo.com: buzón lleno");
  const m2 = await fila1("m2");
  r.push([m2.status === "fallido" && !m2.last_error.includes("@") && m2.last_error.includes("[email]") && m2.last_error.includes("buzón lleno") && m2.sent_at === null,
    `fallido guarda el detalle sin direcciones de email (${m2.last_error})`]);
  await marcar("m2", "fallido", "x".repeat(2000));
  es("el detalle se recorta a 500 caracteres", (await fila1("m2")).last_error.length, 500);
  await marcar("m2", "fallido");
  es("fallido sin detalle deja el detalle en null", (await fila1("m2")).last_error, null);
  await marcar("m2", "enviado");
  const m2b = await fila1("m2");
  r.push([m2b.status === "enviado" && m2b.sent_at !== null && m2b.last_error === null, "un fallido puede terminar «enviado» en un reintento (y se limpia el error)"]);

  // omitido es definitivo.
  await marcar("m3", "omitido", "sin destinatario");
  await marcar("m3", "enviado");
  es("«omitido» no se puede pasar a «enviado»", (await fila1("m3")).status, "omitido");

  // Estados inválidos y filas inexistentes.
  for (const estado of ["pendiente", "enviando", "ENVIADO", "", null]) {
    const got = await hintDe("service", `select public.mark_email_result('${ids5.m4}', ${estado === null ? "null" : `'${estado}'`}, null)`);
    r.push([got === "invalid_status", `estado inválido (${JSON.stringify(estado)}) → hint=${got}`]);
  }
  r.push([(await fila1("m4")).status === "pendiente", "...y la fila no cambió"]);
  await expectHint("un email que no existe", "service", `select public.mark_email_result('${NOEXISTE}', 'enviado')`, "not_found");
  // Pasar solo «fallido» a una fila sin intentos (no reclamada) también se puede anotar.
  await marcar("m5", "fallido", "prueba");
  es("anotar un fallido sobre una fila sin reclamar", (await fila1("m5")).status, "fallido");

  for (const who of ["anon", "alumno", "docente", "admin"]) {
    await sinPermiso(`${who} NO ejecuta mark_email_result`, who, `select public.mark_email_result('${ids5.m4}', 'enviado')`);
  }
  r.push([(await fila1("m4")).status === "pendiente", "...y la fila sigue como estaba"]);
}

// =================================================================================================================
// 9. La bandeja es solo del backend
// =================================================================================================================
{
  await db.exec(`delete from public.email_outbox`);
  const e = await reservaPaga();
  const fila0 = (await q(`select id from public.email_outbox where booking_id = '${e.booking}' limit 1`)).rows[0].id;
  for (const who of ["anon", "alumno", "alumno2", "docente", "docente2", "admin"]) {
    await sinPermiso(`${who} NO lee la bandeja`, who, `select * from public.email_outbox`);
    await sinPermiso(`${who} NO escribe en la bandeja`, who, `insert into public.email_outbox (kind, recipient_id) values ('x', '${ids.alumno}')`);
    await sinPermiso(`${who} NO edita la bandeja`, who, `update public.email_outbox set status = 'enviado'`);
    await sinPermiso(`${who} NO borra de la bandeja`, who, `delete from public.email_outbox where id = '${fila0}'`);
    await sinPermiso(`${who} NO ejecuta claim_pending_emails`, who, `select public.claim_pending_emails()`);
  }
  r.push([(await total()) === 2 && (await q(`select status from public.email_outbox where id = '${fila0}'`)).rows[0].status === "pendiente", "ningún intento tocó la bandeja"]);
  const pol = (await q(`select count(*)::int as n from pg_policies where schemaname = 'public' and tablename = 'email_outbox'`)).rows[0].n;
  const rls = (await q(`select relrowsecurity as v from pg_class where oid = 'public.email_outbox'::regclass`)).rows[0].v;
  r.push([pol === 0 && rls === true, "la RLS está activada y no hay ninguna política (ni siquiera el destinatario lee su email)"]);
  const prv = (await q(`select has_table_privilege('anon', 'public.email_outbox', 'select') or has_table_privilege('authenticated', 'public.email_outbox', 'select')
    or has_table_privilege('authenticated', 'public.email_outbox', 'insert') or has_table_privilege('authenticated', 'public.email_outbox', 'update')
    or has_table_privilege('authenticated', 'public.email_outbox', 'delete') as v`)).rows[0].v;
  r.push([prv === false, "anon y authenticated no tienen ningún permiso sobre la tabla"]);
  await as(db, "service", async () => {
    const x = await q(`select count(*)::int as n from public.email_outbox`);
    r.push([x.rows[0].n === 2, "el backend sí la lee"]);
  });
}
await sinEmailsEnPayloads("al final");

report(r);
