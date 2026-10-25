// Migración 0018: recordatorios de clase (24 horas y 1 hora antes, a las dos partes) y el email de la decisión
// sobre el perfil docente. Se prueban las ventanas, que no se anoten dos veces, que no lleguen pegados al email de
// la reserva, que lo viejo se descarte al reclamar y que todo sea del backend.
import { makeDb, as, ids, expectFail, report } from "./harness.mjs";
import { seed } from "./seed.mjs";
import { makeBookingHelpers } from "./booking-helpers.mjs";

const r = [];
const db = await makeDb();
await seed(db);
const q = (sql) => db.query(sql);
const { reservaPaga } = makeBookingHelpers(db, { slotPrefix: "5a180000" });

/** Mueve la clase para que empiece dentro de `minutes` minutos, reservada hace `bookedHoursAgo` horas antes del inicio. */
const empiezaEn = (booking, minutes, bookedBefore = "3 days") =>
  db.exec(`update public.bookings
    set starts_at = now() + (${minutes} * interval '1 minute'),
        ends_at = now() + (${minutes} * interval '1 minute') + interval '1 hour',
        created_at = now() + (${minutes} * interval '1 minute') - interval '${bookedBefore}'
    where id = '${booking}'`);
const anotar = () => as(db, "service", async () => (await q(`select public.enqueue_class_reminders() as n`)).rows[0].n);
const recordatorios = async (booking) =>
  (await q(`select kind, recipient_id, status, payload from public.email_outbox
            where booking_id = '${booking}' and kind like 'recordatorio%' order by kind, recipient_id`)).rows;
const quien = (id) => Object.keys(ids).find((k) => ids[k] === id);
const resumen = async (booking) => (await recordatorios(booking)).map((x) => `${x.kind}:${quien(x.recipient_id)}`).sort();
const claim = () => as(db, "service", async () => (await q(`select public.claim_pending_emails(100) as r`)).rows[0].r);
const estadoDe = async (booking, kind) =>
  (await q(`select status, last_error from public.email_outbox where booking_id = '${booking}' and kind = '${kind}' order by recipient_id`)).rows;

// --- Ventana de 24 horas ----------------------------------------------------------------------------------------
{
  const { booking } = await reservaPaga();
  await empiezaEn(booking, 25 * 60);
  await anotar();
  r.push([(await resumen(booking)).length === 0, "a 25 horas todavía no se anota nada"]);

  await empiezaEn(booking, 24 * 60 + 20);
  const n = await anotar();
  const got = await resumen(booking);
  r.push([JSON.stringify(got) === JSON.stringify(["recordatorio_24h:alumno", "recordatorio_24h:docente"]), `a 24 h 20 min se anota el de 24 horas para las dos partes → ${got}`]);
  r.push([n >= 2, `...y la función cuenta lo que anotó (${n})`]);
  const [al, dc] = await recordatorios(booking);
  const alumno = al.recipient_id === ids.alumno ? al : dc;
  const docente = al.recipient_id === ids.alumno ? dc : al;
  r.push([alumno.payload.recipient_role === "alumno" && docente.payload.recipient_role === "docente", "cada copia dice a quién va"]);
  r.push([alumno.payload.booking_id === booking && alumno.payload.tutor_name === "docente d1" && alumno.payload.student_name === "alumno a1" && alumno.payload.starts_at, "...y lleva la reserva, los nombres y el horario"]);
  r.push([!("amount_paid" in alumno.payload) && !("tutor_amount" in docente.payload), "...sin datos de dinero"]);

  await anotar();
  r.push([(await resumen(booking)).length === 2, "anotar de nuevo no duplica"]);
}
{
  const { booking } = await reservaPaga();
  await empiezaEn(booking, 23 * 60, "24 hours");
  await anotar();
  r.push([(await resumen(booking)).length === 0, "reservada con menos de 25 horas de anticipación, no hay recordatorio de 24 horas"]);
}
{
  const { booking } = await reservaPaga();
  await empiezaEn(booking, 110);
  await anotar();
  r.push([(await resumen(booking)).every((k) => !k.startsWith("recordatorio_24h")), "a menos de 2 horas no se manda el de 24 horas (va el de 1 hora)"]);
}

// --- Ventana de 1 hora ------------------------------------------------------------------------------------------
{
  const { booking } = await reservaPaga();
  await empiezaEn(booking, 100);
  await anotar();
  r.push([!(await resumen(booking)).some((k) => k.startsWith("recordatorio_1h")), "a 100 minutos todavía no va el de 1 hora"]);
  await empiezaEn(booking, 80);
  await anotar();
  const got = await resumen(booking);
  r.push([got.includes("recordatorio_1h:alumno") && got.includes("recordatorio_1h:docente"), `a 80 minutos se anota el de 1 hora para las dos partes → ${got}`]);
  await empiezaEn(booking, 30);
  await anotar();
  r.push([(await resumen(booking)).filter((k) => k.startsWith("recordatorio_1h")).length === 2, "...una sola vez"]);
}
{
  const { booking } = await reservaPaga();
  await empiezaEn(booking, 60, "90 minutes");
  await anotar();
  r.push([(await resumen(booking)).length === 0, "reservada con menos de 2 horas de anticipación, no hay recordatorio"]);
}
{
  const { booking } = await reservaPaga();
  await empiezaEn(booking, -5);
  await anotar();
  r.push([(await resumen(booking)).length === 0, "una clase que ya empezó no se recuerda"]);
}
{
  const booking = "b0000000-0000-0000-0000-000000000003"; // del seed: no confirmada
  for (const minutos of [24 * 60 + 20, 60]) {
    await empiezaEn(booking, minutos);
    await anotar();
  }
  r.push([(await resumen(booking)).length === 0, "una reserva que no está confirmada no se recuerda (ni 24 horas ni 1 hora antes)"]);
}

// --- Al reclamar, se descarta lo que ya no corresponde -----------------------------------------------------------
{
  const { booking } = await reservaPaga();
  await empiezaEn(booking, 60);
  await anotar();
  await db.exec(`update public.bookings set status = 'cancelada', cancellation_reason = 'prueba' where id = '${booking}'`);
  const claimed = await claim();
  r.push([!claimed.some((x) => x.kind === "recordatorio_1h" && x.payload.booking_id === booking), "el recordatorio de una clase cancelada no se reclama"]);
  const st = await estadoDe(booking, "recordatorio_1h");
  r.push([st.length === 2 && st.every((x) => x.status === "omitido" && x.last_error === "La clase se canceló o ya empezó."), "...queda omitido, con el motivo"]);
}
{
  const { booking } = await reservaPaga();
  await empiezaEn(booking, 60);
  await anotar();
  await empiezaEn(booking, -1);
  await claim();
  r.push([(await estadoDe(booking, "recordatorio_1h")).every((x) => x.status === "omitido"), "el recordatorio de una clase que ya empezó tampoco sale (la bandeja acumulada no manda avisos viejos)"]);
}
{
  const { booking } = await reservaPaga();
  await empiezaEn(booking, 60);
  await anotar();
  const claimed = await claim();
  const mine = claimed.filter((x) => x.kind === "recordatorio_1h" && x.payload.booking_id === booking);
  r.push([mine.length === 2 && mine.every((x) => x.to_email.endsWith("@ejemplo.test")), "uno vigente se reclama normalmente, con el email del destinatario"]);
}

// --- Decisión sobre el perfil docente ---------------------------------------------------------------------------
const decision = async (tutor) =>
  (await q(`select kind, status, payload, booking_id, last_error from public.email_outbox
            where recipient_id = '${ids[tutor]}' and kind like 'perfil%' order by created_at, kind`)).rows;
{
  await as(db, "admin", () => q(`update public.tutor_profiles set verification_status = 'rechazado', verification_reason = '  El respaldo no se abre  ' where id = '${ids.docente2}'`));
  let rows = await decision("docente2");
  r.push([rows.length === 1 && rows[0].kind === "perfil_rechazado" && rows[0].booking_id === null, "al rechazar un perfil se anota un email al docente"]);
  r.push([rows[0].payload.reason === "El respaldo no se abre" && rows[0].payload.tutor_name === "docente d2", "...con el motivo (sin espacios sobrantes) y su nombre"]);

  await as(db, "admin", () => q(`update public.tutor_profiles set bio = 'otra' where id = '${ids.docente2}'`));
  r.push([(await decision("docente2")).length === 1, "editar otro dato del perfil no anota nada"]);

  // El docente reenvía a revisión: el rechazo pendiente ya no corresponde.
  await as(db, "docente2", () => q(`update public.tutor_profiles set verification_status = 'pendiente', verification_reason = null where id = '${ids.docente2}'`));
  r.push([(await decision("docente2")).length === 1, "reenviar a revisión no anota email"]);
  await claim();
  rows = await decision("docente2");
  r.push([rows[0].status === "omitido" && rows[0].last_error === "El estado del perfil cambió.", "el rechazo de un perfil que se reenvió ya no se manda"]);

  await as(db, "admin", () => q(`update public.tutor_profiles set verification_status = 'aprobado', verification_reason = null where id = '${ids.docente2}'`));
  rows = await decision("docente2");
  const ap = rows.find((x) => x.kind === "perfil_aprobado");
  r.push([ap?.status === "pendiente" && ap.payload.can_receive_payments === false && !("reason" in ap.payload), "al aprobar se anota otro, que dice si ya puede cobrar"]);
  const claimed = await claim();
  r.push([claimed.some((x) => x.kind === "perfil_aprobado"), "...y se reclama (el perfil sigue aprobado)"]);
}
{
  // El email nunca hace fallar la decisión.
  await db.exec(`alter table public.email_outbox add constraint romper check (kind <> 'perfil_rechazado') not valid`);
  await as(db, "admin", () => q(`update public.tutor_profiles set verification_status = 'rechazado', verification_reason = 'x' where id = '${ids.docente2}'`));
  const st = (await q(`select verification_status from public.tutor_profiles where id = '${ids.docente2}'`)).rows[0].verification_status;
  r.push([st === "rechazado", "si anotar el email falla, el rechazo se guarda igual"]);
  await db.exec(`alter table public.email_outbox drop constraint romper`);
}

// --- Solo el backend -------------------------------------------------------------------------------------------
for (const who of ["anon", "alumno", "docente", "admin"]) {
  await as(db, who, () => expectFail(`${who} NO puede anotar recordatorios`, q(`select public.enqueue_class_reminders()`), r));
}
await as(db, "admin", () => expectFail("nadie llama al trigger a mano", q(`select public.enqueue_tutor_decision_email()`), r));

report(r);
