// Migración 0027: niveles con nombre y apelación de reseñas. Se prueba el nivel de un docente (la misma regla que la
// comisión de la 0021, con nombre y lo que le falta para el siguiente), quién lo ve, y que una reseña de menos de 3
// estrellas se apele una sola vez, que la decida solo la administración y que, aceptada, deje de contar en todos lados
// sin que el alumno pueda volver a calificar esa clase.
import { makeDb, as, ids, expectFail, expectOk, report, track } from "./harness.mjs";
import { seed } from "./seed.mjs";
import { makeBookingHelpers } from "./booking-helpers.mjs";

const r = track([]);
const db = await makeDb();
await seed(db);
const q = (sql, params) => db.query(sql, params);
const { reservaPaga } = makeBookingHelpers(db, { slotPrefix: "5a270000" });
const hintDe = (promise) => promise.then(() => null, (e) => e.hint ?? e.code ?? `sin hint: ${String(e.message).slice(0, 60)}`);
const esHint = async (label, promise, hint) => {
  const h = await hintDe(promise);
  r.push([h === hint, `${label} → ${h}`]);
};

let extra = 0;
async function alumnoNuevo(nombre = `Alumno ${extra + 1} Pérez`) {
  extra++;
  const id = `a2700000-0000-0000-0000-${String(extra).padStart(12, "0")}`;
  await db.exec(`insert into auth.users (id, email, raw_user_meta_data) values ('${id}', 'y${extra}@ejemplo.test', '{"full_name":"${nombre}","role":"alumno"}')`);
  ids[`y${extra}`] = id;
  return `y${extra}`;
}
/** Una clase completada y paga del docente (terminó hace 2 días), calificada por `student`. Devuelve reserva y reseña. */
async function reseña(student, score, comment = null) {
  const { booking } = await reservaPaga({ student });
  await db.exec(`update public.bookings set status = 'completada', starts_at = now() - interval '2 days', ends_at = now() - interval '2 days' + interval '1 hour' where id = '${booking}'`);
  const rating = (await q(`insert into public.ratings (booking_id, student_id, tutor_id, score, comment) values ($1, $2, $3, $4, $5) returning id`,
    [booking, ids[student], ids.docente, score, comment])).rows[0].id;
  return { booking, rating };
}
const nivel = (who = "docente") => as(db, who, async () => (await q(`select public.my_commission_level() as n`)).rows[0].n);
const apelar = (who, rating, reason = "La alumna no se presentó y calificó igual.") =>
  as(db, who, () => q(`select public.appeal_rating($1, $2) as id`, [rating, reason]));
const decidir = (who, appeal, accept, response = null) =>
  as(db, who, async () => (await q(`select public.decide_rating_appeal($1, $2, $3) as s`, [appeal, accept, response])).rows[0].s);
const promedio = async () => Number((await q(`select rating_promedio from public.tutor_profiles where id = '${ids.docente}'`)).rows[0].rating_promedio);

// --- Los nombres de los niveles -------------------------------------------------------------------------------------
{
  const tiers = (await q(`select name, min_reviews from public.commission_tiers order by min_reviews`)).rows.map((t) => t.name);
  r.push([JSON.stringify(tiers) === JSON.stringify(["Gran profesor", "Maestro", "Gran maestro"]), `los escalones de ejemplo se llaman ${tiers.join(", ")}`]);
  const base = (await q(`select base_name from public.commission_settings`)).rows[0].base_name;
  r.push([base === "Profesor", `la base se llama «${base}»`]);
  await expectFail("un escalón no puede quedar sin nombre", as(db, "admin", () => q(`update public.commission_tiers set name = '  ' where min_reviews = 10`)), r);
  await expectFail("ni con un nombre de más de 40 caracteres", as(db, "admin", () => q(`update public.commission_tiers set name = '${"x".repeat(41)}' where min_reviews = 10`)), r);
  await expectFail("un docente no renombra los niveles", as(db, "docente", async () => {
    const res = await q(`update public.commission_settings set base_name = 'Genio' returning 1`);
    if (!res.rows.length) throw new Error("sin filas");
  }), r);
  await as(db, "admin", () => q(`update public.commission_tiers set name = 'Gran Profe' where min_reviews = 10`));
  const audit = (await q(`select details from public.audit_log where action = 'cambiar_escalon' order by id desc limit 1`)).rows[0]?.details;
  r.push([audit?.after?.name === "Gran Profe" && audit?.before?.name === "Gran profesor", "renombrar un nivel queda en el registro"]);
  await as(db, "admin", () => q(`update public.commission_tiers set name = 'Gran profesor' where min_reviews = 10`));
}

// --- El nivel del docente -------------------------------------------------------------------------------------------
{
  let n = await nivel();
  r.push([n.level_name === "Profesor" && n.reviews === 0 && n.enabled === false && Number(n.rate) === 0.12,
    `sin reseñas: ${n.level_name}, ${n.reviews} reseñas, comisión ${n.rate}, regla ${n.enabled ? "encendida" : "apagada"}`]);
  r.push([n.next?.name === "Gran profesor" && n.next.min_reviews === 10 && Number(n.next.min_rating) === 4.5 && Number(n.next.rate) === 0.1,
    `el siguiente es ${n.next?.name} (${n.next?.min_reviews} reseñas, ${n.next?.min_rating}, ${n.next?.rate})`]);
  await esHint("un alumno no tiene nivel", nivel("alumno"), "not_tutor");
  await esHint("sin sesión, tampoco", nivel("anon"), "42501");

  for (let i = 0; i < 10; i++) await reseña(await alumnoNuevo(), 5);
  n = await nivel();
  r.push([n.level_name === "Gran profesor" && Number(n.rate) === 0.12 && n.next?.name === "Maestro",
    `con 10 reseñas de 5 estrellas: ${n.level_name}; con la regla apagada sigue pagando ${n.rate}; el siguiente es ${n.next?.name}`]);

  await as(db, "admin", () => q(`update public.commission_settings set enabled = true`));
  n = await nivel();
  const tasa = Number((await as(db, "alumno", () => q(`select public.commission_rate_for('${ids.docente}') as t`))).rows[0].t);
  r.push([n.enabled === true && Number(n.rate) === 0.1 && tasa === 0.1, `encendida: paga ${n.rate}, lo mismo que cobra la reserva (${tasa})`]);

  // Un escalón desactivado no da nivel.
  await as(db, "admin", () => q(`update public.commission_tiers set active = false where min_reviews = 10`));
  n = await nivel();
  r.push([n.level_name === "Profesor" && n.next?.name === "Maestro", `con «Gran profesor» desactivado vuelve a ${n.level_name} (siguiente: ${n.next?.name})`]);
  await as(db, "admin", () => q(`update public.commission_tiers set active = true where min_reviews = 10`));

  // Dos escalones que el docente cumple: el de comisión más baja.
  await as(db, "admin", () => q(`insert into public.commission_tiers (name, min_reviews, min_rating, rate) values ('Leyenda', 5, 4.9, 0.07)`));
  n = await nivel();
  r.push([n.level_name === "Leyenda" && Number(n.rate) === 0.07, `con dos escalones cumplidos queda en el de menos comisión: ${n.level_name}, ${n.rate}`]);
  r.push([n.next?.name === "Gran maestro", `y el siguiente es el que baja más la comisión: ${n.next?.name}`]);
  // Nunca menos que el piso.
  await as(db, "admin", () => q(`update public.commission_tiers set rate = 0.02 where name = 'Leyenda'`));
  n = await nivel();
  r.push([Number(n.rate) === 0.06 && n.next === null, `un escalón por debajo del piso cobra el piso (${n.rate}) y ya no hay siguiente`]);
  await as(db, "admin", () => q(`delete from public.commission_tiers where name = 'Leyenda'`));

  const niveles = await as(db, "admin", async () => (await q(`select * from public.commission_levels()`)).rows);
  const delDocente = niveles.find((x) => x.tutor_id === ids.docente)?.level_name;
  r.push([delDocente === "Gran profesor", `la administración ve el nivel de cada docente aprobado (${delDocente})`]);
  await esHint("un docente no ve el nivel de los demás", as(db, "docente", () => q(`select * from public.commission_levels()`)), "not_admin");
}

// --- Apelar -----------------------------------------------------------------------------------------------------------
const alumna = await alumnoNuevo("Sofía Gómez");
const otroAlumno = await alumnoNuevo("Juan Díaz");
const mala = await reseña(alumna, 1, "No me sirvió para nada");
const otraMala = await reseña(otroAlumno, 2, "Llegó tarde");
const regular = await reseña(await alumnoNuevo(), 3);
const antes = await promedio();

await esHint("una reseña de 3 estrellas no se apela", apelar("docente", regular.rating), "not_appealable");
await esHint("un docente no apela la reseña de otro", apelar("docente2", mala.rating), "not_found");
await esHint("un alumno no apela", apelar("alumno", mala.rating), "not_found");
await esHint("sin sesión, nadie apela", apelar("anon", mala.rating), "42501");
await esHint("sin motivo no se apela", apelar("docente", mala.rating, "   "), "reason_required");
await esHint("con un motivo de menos de 10 caracteres, tampoco", apelar("docente", mala.rating, "porque sí"), "reason_required");
await esHint("ni con uno de más de 600", apelar("docente", mala.rating, "x".repeat(601)), "reason_too_long");
const apelacion = (await apelar("docente", mala.rating, "  No se presentó a la clase.  ")).rows[0].id;
r.push([Boolean(apelacion), "el docente apela su reseña de 1 estrella"]);
await esHint("una reseña se apela una sola vez", apelar("docente", mala.rating), "already_appealed");
const apelacion2 = (await apelar("docente", otraMala.rating)).rows[0].id;
{
  const a = (await q(`select * from public.rating_appeals where id = $1`, [apelacion])).rows[0];
  r.push([a.status === "pendiente" && a.reason === "No se presentó a la clase." && a.score === 1 && a.comment === "No me sirvió para nada",
    "la apelación queda pendiente, con el motivo limpio y una copia de la reseña"]);
}
await expectFail("nadie crea una apelación sin la función", as(db, "docente", () =>
  q(`insert into public.rating_appeals (rating_id, booking_id, tutor_id, student_id, score, rated_at, reason, status, decided_at)
     values ($1, $2, $3, $4, 2, now(), 'motivo largo de verdad', 'aceptada', now())`, [regular.rating, regular.booking, ids.docente, ids.alumno])), r);
await expectFail("ni la cambia", as(db, "docente", () => q(`update public.rating_appeals set status = 'aceptada', decided_at = now() where id = $1`, [apelacion])), r);
r.push([(await q(`select status from public.rating_appeals where id = $1`, [apelacion])).rows[0].status === "pendiente", "el docente no se acepta su propia apelación"]);

// --- Quién ve las apelaciones -------------------------------------------------------------------------------------------
const ve = (who) => as(db, who, async () => (await q(`select id from public.rating_appeals`)).rows.length);
r.push([(await ve("docente")) === 2, "el docente ve sus apelaciones"]);
r.push([(await ve("docente2")) === 0, "otro docente no las ve"]);
r.push([(await ve("admin")) === 2, "la administración las ve"]);
r.push([(await ve(alumna)) === 0, "el alumno no ve que su reseña está apelada"]);
await esHint("un docente no ve la lista de la administración", as(db, "docente", () => q(`select * from public.admin_rating_appeals()`)), "not_admin");
{
  const lista = await as(db, "admin", async () => (await q(`select * from public.admin_rating_appeals()`)).rows);
  r.push([lista.length === 2 && lista.every((x) => x.status === "pendiente") && lista[0].appeal_id === apelacion && lista[0].student_name === "Sofía Gómez",
    "la administración ve las pendientes, la más vieja primero, con el nombre del alumno"]);
}

// --- Decidir -----------------------------------------------------------------------------------------------------------
await esHint("un docente no decide apelaciones", decidir("docente", apelacion, true), "not_admin");
await esHint("rechazar sin respuesta no se puede", decidir("admin", apelacion2, false, "  "), "response_required");
r.push([(await decidir("admin", apelacion2, false, "La reseña describe la clase.")) === "rechazada", "la administración rechaza una apelación con su respuesta"]);
r.push([(await q(`select count(*)::int as n from public.ratings where id = $1`, [otraMala.rating])).rows[0].n === 1, "rechazada, la reseña sigue"]);
await esHint("una apelación se decide una sola vez", decidir("admin", apelacion2, true), "already_decided");

r.push([(await decidir("admin", apelacion, true)) === "aceptada", "la administración acepta la otra"]);
r.push([(await q(`select count(*)::int as n from public.ratings where id = $1`, [mala.rating])).rows[0].n === 0, "aceptada, la reseña se quita"]);
{
  const despues = await promedio();
  r.push([despues > antes, `el promedio del docente se recalcula sin ella (${antes} → ${despues})`]);
  const publicas = await as(db, "anon", async () => (await q(`select comment from public.tutor_reviews('${ids.docente}')`)).rows.map((x) => x.comment));
  r.push([!publicas.includes("No me sirvió para nada") && publicas.includes("Llegó tarde"), "ya no aparece en las opiniones públicas (la rechazada sí)"]);
  const st = (await q(`select * from public.tutor_review_stats('${ids.docente}')`)).rows[0];
  r.push([st.reviews === 12, `ni cuenta para la comisión (${st.reviews} reseñas que cuentan)`]);
}

// El alumno ve que se quitó (para no ofrecerle calificar de nuevo) y no puede volver a calificar esa clase.
{
  r.push([(await ve(alumna)) === 1, "el alumno ve que su reseña se quitó"]);
  r.push([(await ve(otroAlumno)) === 0, "el de la apelación rechazada no ve nada"]);
  await esHint("el alumno no puede volver a calificar esa clase", as(db, alumna, () =>
    q(`insert into public.ratings (booking_id, student_id, tutor_id, score) values ($1, $2, $3, 5)`, [mala.booking, ids[alumna], ids.docente])), "rating_removed");
}

// --- Lo que ve el docente ----------------------------------------------------------------------------------------------
{
  const mias = await as(db, "docente", async () => (await q(`select * from public.my_reviews()`)).rows);
  const quitada = mias.find((x) => x.rating_id === mala.rating);
  const rechazada = mias.find((x) => x.rating_id === otraMala.rating);
  r.push([mias.length === 13, `el docente ve sus reseñas, también la quitada (${mias.length})`]);
  r.push([quitada?.removed === true && quitada.appeal_status === "aceptada" && quitada.author_name === "Sofía G.", "la quitada figura como quitada, con el autor abreviado"]);
  r.push([rechazada?.removed === false && rechazada.appeal_status === "rechazada" && rechazada.appeal_response === "La reseña describe la clase.", "la rechazada, con la respuesta de la administración"]);
  const otro = await as(db, "docente2", async () => (await q(`select * from public.my_reviews()`)).rows);
  r.push([otro.length === 0, "otro docente no ve las reseñas ajenas"]);
  await esHint("sin sesión no hay reseñas propias", as(db, "anon", () => q(`select * from public.my_reviews()`)), "42501");
}

// --- El registro ---------------------------------------------------------------------------------------------------------
{
  const filas = (await q(`select action, actor_kind, reason, target_id from public.audit_log where target_type = 'resena' order by id`)).rows;
  const acciones = filas.map((x) => `${x.action}/${x.actor_kind}`);
  r.push([JSON.stringify(acciones) === JSON.stringify(["apelar_resena/docente", "apelar_resena/docente", "rechazar_apelacion/administracion", "quitar_resena/administracion"]),
    `cada apelación y decisión queda en el registro (${acciones.join(", ")})`]);
  r.push([filas[0].reason === "No se presentó a la clase." && filas[0].target_id === mala.rating, "con el motivo y la reseña"]);
}

await expectOk("borrar la reserva se lleva la apelación", q(`delete from public.bookings where id = $1`, [otraMala.booking]), r);
r.push([(await q(`select count(*)::int as n from public.rating_appeals where id = $1`, [apelacion2])).rows[0].n === 0, "...y no queda colgada"]);

report(r);
