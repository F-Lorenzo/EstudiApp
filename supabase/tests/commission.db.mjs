// Migración 0021: comisión por reputación. Se prueba que apagada todos paguen la base, que encendida elija el
// escalón más bajo que el docente cumple sin bajar del piso, qué reseñas cuentan (clases completadas y pagas, un
// alumno = una reseña), que la reserva guarde la tasa del momento, quién edita y que todo quede en el registro.
import { makeDb, as, ids, expectFail, report } from "./harness.mjs";
import { seed } from "./seed.mjs";
import { makeBookingHelpers } from "./booking-helpers.mjs";

const r = [];
const db = await makeDb();
await seed(db);
const q = (sql) => db.query(sql);
const { reservaPaga, reservaSinPagar } = makeBookingHelpers(db, { slotPrefix: "5a210000" });

const tasa = async (tutor = "docente") => Number((await as(db, "alumno", async () => (await q(`select public.commission_rate_for('${ids[tutor]}') as t`)).rows[0].t)));
const stats = async (tutor = "docente") => (await q(`select * from public.tutor_review_stats('${ids[tutor]}')`)).rows[0];
const encender = (on = true) => as(db, "admin", () => q(`update public.commission_settings set enabled = ${on}`));

/** Cuentas de alumno extra (`n` alumnos distintos), creadas directo en auth.users como en el seed. */
let extra = 0;
async function alumnoNuevo() {
  extra++;
  const id = `a2100000-0000-0000-0000-${String(extra).padStart(12, "0")}`;
  await db.exec(`insert into auth.users (id, email, raw_user_meta_data) values ('${id}', 'x${extra}@ejemplo.test', '{"full_name":"Alumno ${extra}","role":"alumno"}')`);
  ids[`x${extra}`] = id;
  return `x${extra}`;
}
/** Una clase completada y paga del docente, calificada por `student` con `score`. */
async function reseña(student, score, { pagada = true } = {}) {
  let booking;
  if (pagada) ({ booking } = await reservaPaga({ student }));
  else {
    ({ booking } = await reservaSinPagar({ student }));
  }
  await db.exec(`update public.bookings set status = 'completada', starts_at = now() - interval '2 days', ends_at = now() - interval '2 days' + interval '1 hour' where id = '${booking}'`);
  await db.exec(`insert into public.ratings (booking_id, student_id, tutor_id, score) values ('${booking}', '${ids[student]}', '${ids.docente}', ${score})`);
  return booking;
}

// --- Apagada por defecto ------------------------------------------------------------------------------------------
{
  const s = (await q(`select * from public.commission_settings`)).rows[0];
  r.push([s.enabled === false && Number(s.base_rate) === 0.12 && Number(s.floor_rate) === 0.06, "arranca apagada, con base 12 % y piso 6 %"]);
  const tiers = (await q(`select min_reviews, min_rating, rate from public.commission_tiers order by min_reviews`)).rows.map((t) => `${t.min_reviews}/${Number(t.min_rating)}/${Number(t.rate)}`);
  r.push([JSON.stringify(tiers) === JSON.stringify(["10/4.5/0.1", "25/4.7/0.08", "50/4.8/0.06"]), `con los escalones de ejemplo (${tiers})`]);
  r.push([(await tasa()) === 0.12, "apagada, la comisión es 12 %"]);
}

// --- Qué reseñas cuentan --------------------------------------------------------------------------------------------
{
  const students = [];
  for (let i = 0; i < 10; i++) students.push(await alumnoNuevo());
  for (const s of students) await reseña(s, 5);
  let st = await stats();
  r.push([st.reviews === 10 && Number(st.average) === 5, `diez alumnos distintos con 5 estrellas: ${st.reviews} reseñas, ${st.average}`]);

  // Un mismo alumno que califica muchas clases cuenta una vez, con su promedio.
  const insistente = students[0];
  await reseña(insistente, 1);
  st = await stats();
  r.push([st.reviews === 10 && Number(st.average) === 4.8, `el mismo alumno calificando otra clase no suma una reseña; cuenta su promedio (${st.reviews}, ${st.average})`]);

  // Una clase sin pago aprobado no cuenta.
  const sinPago = await alumnoNuevo();
  await reseña(sinPago, 5, { pagada: false });
  st = await stats();
  r.push([st.reviews === 10, "la reseña de una clase sin pago aprobado no cuenta"]);

  // Apagada, sigue en la base aunque cumpla el escalón.
  r.push([(await tasa()) === 0.12, "apagada, aunque cumpla un escalón, paga la base"]);

  await encender();
  r.push([(await tasa()) === 0.1, "encendida, con 10 reseñas y 4,8 baja a 10 %"]);
  r.push([(await tasa("docente2")) === 0.12, "un docente sin reseñas sigue en 12 %"]);

  // El piso: un escalón por debajo del piso no se aplica más bajo que el piso.
  await as(db, "admin", () => q(`insert into public.commission_tiers (min_reviews, min_rating, rate) values (5, 4.0, 0.02)`));
  r.push([(await tasa()) === 0.06, "un escalón de 2 % no baja del piso de 6 %"]);
  await as(db, "admin", () => q(`update public.commission_tiers set active = false where rate = 0.02`));
  r.push([(await tasa()) === 0.1, "un escalón desactivado no cuenta"]);

  // Calificación por debajo del mínimo del escalón.
  await as(db, "admin", () => q(`update public.commission_tiers set min_rating = 4.9 where min_reviews = 10`));
  r.push([(await tasa()) === 0.12, "con 4,8 no alcanza un escalón que pide 4,9"]);
  await as(db, "admin", () => q(`update public.commission_tiers set min_rating = 4.5 where min_reviews = 10`));

  // La reserva guarda la tasa del momento.
  const { booking } = await reservaPaga({ student: students[1] });
  const guardada = Number((await q(`select commission_rate from public.bookings where id = '${booking}'`)).rows[0].commission_rate);
  r.push([guardada === 0.1, `una reserva nueva guarda la comisión del momento (${guardada})`]);
  const pago = (await q(`select commission_amount, tutor_amount from public.payments where booking_id = '${booking}'`)).rows[0];
  r.push([Number(pago.commission_amount) === 1000 && Number(pago.tutor_amount) === 9000, "...y el pago se reparte con esa comisión (1000 de 10000)"]);
  await encender(false);
  const igual = Number((await q(`select commission_rate from public.bookings where id = '${booking}'`)).rows[0].commission_rate);
  r.push([igual === 0.1 && (await tasa()) === 0.12, "apagarla no toca las reservas ya hechas; las nuevas vuelven a 12 %"]);
}

// --- Vista previa --------------------------------------------------------------------------------------------------
{
  const rows = await as(db, "admin", async () => (await q(`select * from public.commission_preview()`)).rows);
  const d1 = rows.find((x) => x.tutor_id === ids.docente);
  r.push([d1 && d1.reviews === 10 && Number(d1.rate_if_enabled) === 0.1 && Number(d1.current_rate) === 0.12, "la vista previa muestra la que tendría encendida y la de hoy"]);
  for (const who of ["alumno", "docente"]) {
    const hint = await as(db, who, () => q(`select * from public.commission_preview()`)).then(() => null, (e) => e.hint);
    r.push([hint === "not_admin", `${who} NO ve la vista previa`]);
  }
}

// --- Quién edita, validaciones y registro ------------------------------------------------------------------------------
{
  for (const who of ["alumno", "docente"]) {
    const n = await as(db, who, async () => (await q(`update public.commission_settings set enabled = true returning 1`)).rows.length).catch(() => 0);
    r.push([n === 0, `${who} NO puede encender la regla`]);
    await as(db, who, () => expectFail(`${who} NO crea escalones`, q(`insert into public.commission_tiers (min_reviews, min_rating, rate) values (1, 1, 0.01)`), r));
    const ve = await as(db, who, async () => (await q(`select count(*)::int as n from public.commission_tiers`)).rows[0].n).catch(() => 0);
    r.push([ve === 0, `${who} NO ve los escalones`]);
  }
  await as(db, "anon", () => expectFail("un visitante NO lee la configuración", q(`select * from public.commission_settings`), r));
  await as(db, "admin", () => expectFail("el piso no puede quedar por encima de la base", q(`update public.commission_settings set floor_rate = 0.2`), r));
  await as(db, "admin", () => expectFail("un escalón necesita al menos 1 reseña", q(`insert into public.commission_tiers (min_reviews, min_rating, rate) values (0, 4, 0.1)`), r));
  await as(db, "admin", () => expectFail("la calificación mínima va de 1 a 5", q(`insert into public.commission_tiers (min_reviews, min_rating, rate) values (3, 6, 0.1)`), r));
  await as(db, "admin", () => expectFail("no se borra la configuración", q(`delete from public.commission_settings`), r));
  await as(db, "admin", () => expectFail("no hay segunda configuración", q(`insert into public.commission_settings (id) values (false)`), r));

  const log = (await q(`select action, actor_kind, details from public.audit_log where target_type = 'comision' order by id`)).rows;
  const acciones = log.map((x) => x.action);
  r.push([acciones.filter((a) => a === "cambiar_comision").length === 2, `encender y apagar quedan en el registro (${acciones.filter((a) => a === "cambiar_comision").length})`]);
  r.push([acciones.includes("crear_escalon") && acciones.includes("cambiar_escalon"), "crear y cambiar escalones también"]);
  const on = log.find((x) => x.action === "cambiar_comision");
  r.push([on.actor_kind === "administracion" && on.details.before.enabled === false && on.details.after.enabled === true, "...con el antes y el después"]);
  await as(db, "admin", () => q(`delete from public.commission_tiers where rate = 0.02`));
  const borrado = (await q(`select count(*)::int as n from public.audit_log where action = 'borrar_escalon'`)).rows[0].n;
  r.push([borrado === 1, "borrar un escalón queda registrado"]);
}

report(r);
