// Migración 0024: límites contra el abuso. Se prueba el tope de intentos de pago con tarjeta (por reserva y por
// alumno en 24 horas), el de reservas sin pagar que vencieron o se cancelaron en el día, qué no cuenta, y que todo
// sea solo del backend.
import { makeDb, as, ids, report } from "./harness.mjs";
import { seed } from "./seed.mjs";
import { makeBookingHelpers } from "./booking-helpers.mjs";

const r = [];
const db = await makeDb();
await seed(db);
const q = (sql) => db.query(sql);
const { reservaSinPagar, reservaPaga } = makeBookingHelpers(db, { slotPrefix: "5a240000" });

let extra = 0;
async function alumnoNuevo() {
  extra++;
  const id = `a2400000-0000-0000-0000-${String(extra).padStart(12, "0")}`;
  await db.exec(`insert into auth.users (id, email, raw_user_meta_data) values ('${id}', 'l${extra}@ejemplo.test', '{"full_name":"Alumno ${extra}","role":"alumno"}')`);
  ids[`l${extra}`] = id;
  return `l${extra}`;
}
const hintDe = (promise) => promise.then(() => null, (e) => e.hint ?? `sin hint: ${String(e.message).slice(0, 60)}`);
const intento = (booking) => hintDe(as(db, "service", () => q(`select public.register_card_attempt('${booking}')`)));
const cancelar = (booking) => db.exec(`update public.bookings set status = 'cancelada', cancellation_reason = 'No se completó el pago a tiempo' where id = '${booking}'`);

// --- Intentos de pago con tarjeta ----------------------------------------------------------------------------------
{
  const s = await alumnoNuevo();
  const { booking } = await reservaSinPagar({ student: s });
  const primeros = [];
  for (let i = 0; i < 5; i++) primeros.push(await intento(booking));
  r.push([primeros.every((h) => h === null), "los 5 primeros intentos de una reserva pasan"]);
  r.push([(await intento(booking)) === "too_many_card_attempts_booking", "el 6.º en la misma reserva no"]);
  const n = (await q(`select count(*)::int as n from public.card_payment_attempts where booking_id = '${booking}'`)).rows[0].n;
  r.push([n === 5, `el intento rechazado no se anota (${n})`]);

  // Con otra reserva sigue hasta 10 en el día.
  await cancelar(booking);
  const { booking: otra } = await reservaSinPagar({ student: s });
  const siguientes = [];
  for (let i = 0; i < 5; i++) siguientes.push(await intento(otra));
  r.push([siguientes.every((h) => h === null), "con otra reserva tiene 5 intentos más (10 en el día)"]);
  await cancelar(otra);
  const { booking: tercera } = await reservaSinPagar({ student: s });
  r.push([(await intento(tercera)) === "too_many_card_attempts", "el 11.º del día no pasa, aunque sea en una reserva nueva"]);

  // Los de hace más de 24 horas no cuentan para el día.
  await db.exec(`update public.card_payment_attempts set created_at = now() - interval '25 hours' where student_id = '${ids[s]}'`);
  r.push([(await intento(tercera)) === null, "al día siguiente vuelve a poder"]);
  // Pero el tope por reserva no vence.
  await db.exec(`update public.card_payment_attempts set created_at = now() - interval '25 hours' where booking_id = '${booking}'`);
  r.push([(await intento(booking)) === "too_many_card_attempts_booking", "el tope de 5 por reserva no vence con el tiempo"]);

  const otro = await alumnoNuevo();
  const { booking: ajena } = await reservaSinPagar({ student: otro });
  r.push([(await intento(ajena)) === null, "otro alumno no se ve afectado"]);
  r.push([(await intento("99999999-9999-9999-9999-999999999999")) === "not_found", "una reserva que no existe: not_found"]);
}

// --- Reservas sin pagar por día ------------------------------------------------------------------------------------
{
  const s = await alumnoNuevo();
  let creadas = 0;
  for (let i = 0; i < 10; i++) {
    const { booking } = await reservaSinPagar({ student: s });
    await cancelar(booking);
    creadas++;
  }
  r.push([creadas === 10, "10 reservas sin pagar que vencieron en el día se pueden crear"]);
  const once = await hintDe(reservaSinPagar({ student: s }));
  r.push([once === "too_many_daily_holds", `la 11.ª no (${once})`]);

  // Una reserva paga que después se canceló no cuenta.
  const s2 = await alumnoNuevo();
  for (let i = 0; i < 9; i++) await cancelar((await reservaSinPagar({ student: s2 })).booking);
  const paga = await reservaPaga({ student: s2 });
  await cancelar(paga.booking);
  r.push([(await hintDe(reservaSinPagar({ student: s2 }))) === null, "una reserva paga y cancelada no cuenta para el tope"]);

  // Las de hace más de 24 horas tampoco.
  await db.exec(`update public.bookings set created_at = now() - interval '25 hours' where student_id = '${ids[s]}' and status = 'cancelada'`);
  r.push([(await hintDe(reservaSinPagar({ student: s }))) === null, "al día siguiente vuelve a poder reservar"]);

  // Otro alumno no se ve afectado.
  const s3 = await alumnoNuevo();
  r.push([(await hintDe(reservaSinPagar({ student: s3 }))) === null, "otro alumno reserva normalmente"]);
}

// --- Solo del backend ----------------------------------------------------------------------------------------------
for (const who of ["anon", "alumno", "docente", "admin"]) {
  const h = await hintDe(as(db, who, () => q(`select public.register_card_attempt(gen_random_uuid())`)));
  r.push([typeof h === "string" && h.startsWith("sin hint: permission denied"), `${who} NO registra intentos (${h})`]);
  const lee = await as(db, who, () => q(`select count(*) from public.card_payment_attempts`)).then(() => "lee", () => "no");
  r.push([lee === "no", `${who} NO lee los intentos`]);
}

report(r);
