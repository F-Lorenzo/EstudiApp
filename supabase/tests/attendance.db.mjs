// La clase se completa según la asistencia a la sala (migración 0017).
import { makeDb, as, expectFail, report } from "./harness.mjs";
import { seed } from "./seed.mjs";
import { makeBookingHelpers } from "./booking-helpers.mjs";

const r = [];
const db = await makeDb();
await seed(db);
const q = (sql) => db.query(sql);
const { reservaPaga } = makeBookingHelpers(db, { slotPrefix: "5a170000" });

/** Mueve la clase para que haya terminado hace `minutes` minutos (negativo: termina en el futuro). */
const terminoHace = (booking, minutes) =>
  db.exec(`update public.bookings
    set starts_at = now() - (${minutes} * interval '1 minute') - interval '1 hour',
        ends_at = now() - (${minutes} * interval '1 minute')
    where id = '${booking}'`);
const registrar = (booking, tutor, student) =>
  as(db, "service", async () => (await q(`select public.record_class_attendance('${booking}', ${tutor}, ${student}) as r`)).rows[0].r);
const estado = async (booking) => (await q(`select status, cancellation_reason from public.bookings where id = '${booking}'`)).rows[0];
const asistencia = async (booking) => (await q(`select * from public.class_attendance where booking_id = '${booking}'`)).rows[0];
const reembolso = async (booking) => (await q(`select percent, amount, reason, status from public.refunds where booking_id = '${booking}'`)).rows[0];

// --- El docente estuvo 10 minutos o más: la clase cuenta como dada -------------------------------------------
{
  const { booking } = await reservaPaga();
  await terminoHace(booking, -30);
  r.push([(await registrar(booking, 3000, 3000)).outcome === "pendiente", "antes de que termine el horario no se decide nada"]);
  r.push([(await asistencia(booking)) === undefined, "...y no se anota la asistencia"]);

  await terminoHace(booking, 1);
  const res = await registrar(booking, 600, 0);
  r.push([res.outcome === "completada", "con el docente 10 minutos, se completa apenas termina (aunque el alumno no entre)"]);
  r.push([(await estado(booking)).status === "completada", "...la reserva queda completada"]);
  r.push([(await reembolso(booking)) === undefined, "...y no hay reembolso"]);
  const a = await asistencia(booking);
  r.push([a?.tutor_seconds === 600 && a?.student_seconds === 0 && a?.outcome === "completada", "...con los minutos de cada uno anotados"]);

  const otra = await registrar(booking, 0, 0);
  r.push([otra.outcome === "completada" && otra.already === true, "registrar de nuevo devuelve lo registrado, sin cambiar nada"]);
}

// --- El docente estuvo menos de 10 minutos ------------------------------------------------------------------
{
  const { booking, price } = await reservaPaga({ price: 12000 });
  await terminoHace(booking, 5);
  r.push([(await registrar(booking, 599, 3600)).outcome === "pendiente", "con el docente 9:59, mientras la sala sigue abierta, se espera"]);
  r.push([(await estado(booking)).status === "confirmada", "...y la reserva sigue confirmada"]);

  await terminoHace(booking, 11);
  const res = await registrar(booking, 599, 3600);
  r.push([res.outcome === "docente_ausente" && res.percent === 100 && Number(res.amount) === price, `cerrada la sala, se cancela con el 100 % (${res.percent} %, ${res.amount})`]);
  r.push([res.paid === true && res.cancelled_by === "administracion" && res.refund?.status === "pendiente", "...con la forma de cancel_booking y el reembolso en la cola"]);
  const e = await estado(booking);
  r.push([e.status === "cancelada" && e.cancellation_reason === "El docente no se presentó a la clase.", "...la reserva queda cancelada por ausencia del docente"]);
  const rf = await reembolso(booking);
  r.push([rf?.percent === 100 && Number(rf?.amount) === price && rf?.reason === "docente_ausente", "...y el reembolso es del 100 % por ausencia"]);
  const emails = (await q(`select count(*)::int as n from public.email_outbox where booking_id = '${booking}' and kind = 'reserva_cancelada'`)).rows[0].n;
  r.push([emails === 2, `...y se avisa a las dos partes (${emails} emails)`]);
  r.push([(await registrar(booking, 9999, 0)).already === true, "una asistencia tardía no deshace la cancelación"]);
}

// --- Nadie entró ---------------------------------------------------------------------------------------------
{
  const { booking } = await reservaPaga();
  await terminoHace(booking, 30);
  r.push([(await registrar(booking, 0, 0)).outcome === "docente_ausente", "si nadie entró, también se reembolsa (falta el docente)"]);
}

// --- Una reserva confirmada sin pago (cargada a mano): se cancela sin reembolso que encolar ---------------------
{
  const booking = "b0000000-0000-0000-0000-000000000002"; // del seed: confirmada, sin pago
  await terminoHace(booking, 30);
  const res = await registrar(booking, 0, 1200);
  r.push([res.outcome === "docente_ausente" && res.paid === false && res.percent === 0 && res.refund === null, "sin pago, se cancela informando que no había nada que devolver"]);
  r.push([(await reembolso(booking)) === undefined, "...y no se encola ningún reembolso"]);
}

// --- Qué se puede registrar ----------------------------------------------------------------------------------
{
  const { booking } = await reservaPaga();
  await terminoHace(booking, 30);
  await as(db, "service", () => expectFail("NO se aceptan segundos negativos", q(`select public.record_class_attendance('${booking}', -1, 0)`), r));
  await as(db, "service", () => expectFail("NO se registra una reserva que no está confirmada", q(`select public.record_class_attendance('b0000000-0000-0000-0000-000000000003', 3600, 3600)`), r));
  for (const who of ["anon", "alumno", "docente", "admin"]) {
    await as(db, who, () => expectFail(`${who} NO puede registrar asistencia`, q(`select public.record_class_attendance('${booking}', 3600, 3600)`), r));
  }
  await as(db, "docente", () => expectFail("el docente NO escribe la tabla de asistencia", q(`insert into public.class_attendance (booking_id, tutor_seconds, student_seconds, outcome) values ('${booking}', 3600, 0, 'completada')`), r));

  const pendientes = await as(db, "service", async () => (await q(`select booking_id from public.classes_awaiting_attendance()`)).rows.map((x) => x.booking_id));
  r.push([pendientes.includes(booking), "la clase terminada sin asistencia aparece como pendiente"]);
  await registrar(booking, 3600, 3600);
  const despues = await as(db, "service", async () => (await q(`select booking_id from public.classes_awaiting_attendance()`)).rows.map((x) => x.booking_id));
  r.push([!despues.includes(booking), "...y deja de aparecer una vez registrada"]);
  await as(db, "alumno", () => expectFail("un alumno NO lista las clases pendientes", q(`select * from public.classes_awaiting_attendance()`), r));

  // Sin permiso sobre la tabla (el visitante) también cuenta como «no la ve».
  const ve = async (who) =>
    as(db, who, async () => (await q(`select booking_id from public.class_attendance where booking_id = '${booking}'`)).rows.length).catch(() => 0);
  r.push([(await ve("alumno")) === 1 && (await ve("docente")) === 1 && (await ve("admin")) === 1, "la asistencia la ven el alumno, el docente y la administración"]);
  r.push([(await ve("alumno2")) === 0 && (await ve("docente2")) === 0 && (await ve("anon")) === 0, "...y nadie más"]);
}

// --- Red de seguridad: sin asistencia en 3 días, se completa --------------------------------------------------
{
  const { booking } = await reservaPaga();
  await terminoHace(booking, 60 * 24 * 2);
  await as(db, "alumno", () => q(`select public.sync_bookings()`));
  r.push([(await estado(booking)).status === "confirmada", "2 días después de terminar, sin asistencia, sigue esperando"]);
  await terminoHace(booking, 60 * 24 * 3 + 1);
  await as(db, "alumno", () => q(`select public.sync_bookings()`));
  r.push([(await estado(booking)).status === "completada", "pasados 3 días se completa sola (nunca reembolsa por falta de datos)"]);
  r.push([(await reembolso(booking)) === undefined, "...sin reembolso"]);
}

report(r);
