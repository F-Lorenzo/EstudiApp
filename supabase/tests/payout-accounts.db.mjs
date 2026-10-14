// Migración 0014: cuentas de cobro de los docentes. Guardar y renovar las credenciales de Mercado Pago (solo el
// backend), desvincular (solo el propio docente, y no con plata en camino), saber si un docente puede cobrar, y que
// no se pueda reservar con un docente que no cobra. Los tokens no se leen desde ninguna sesión de la API.
import { makeDb, as, ids, report, track } from "./harness.mjs";
import { seed } from "./seed.mjs";

const r = track([]);
const db = await makeDb();
await seed(db);
const q = (sql) => db.query(sql);
const S = (n) => `55000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
const D3 = "00000000-0000-0000-0000-0000000000d3";
const NOEXISTE = "99999999-9999-9999-9999-999999999999";
const TOKEN_A = "token-secreto-de-acceso-AAAA";
const TOKEN_R = "token-secreto-de-renovacion-RRRR";

const lit = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const hintDe = async (who, sql) => {
  try { await as(db, who, () => q(sql)); return null; } catch (e) { return e.hint ?? `sin hint: ${String(e.message).slice(0, 60)}`; }
};
const expectHint = async (label, who, sql, hint) => {
  const got = await hintDe(who, sql);
  r.push([got === hint, `${label}  → hint=${got}`]);
};
const sinPermiso = async (label, who, sql) => {
  const got = await hintDe(who, sql);
  r.push([typeof got === "string" && got.startsWith("sin hint: permission denied"), `${label}  → ${got}`]);
};
const es = (label, got, want) => r.push([JSON.stringify(got) === JSON.stringify(want), `${label} → ${JSON.stringify(got)}`]);

/** select public.save_mp_credentials(...) con valores por defecto razonables. */
const guardar = (tutor, mp, { access = TOKEN_A, refresh = TOKEN_R, pk = "APP_USR-pk", expira = "now() + interval '100 days'", live = true } = {}) =>
  `select public.save_mp_credentials(${lit(tutor)}, ${lit(mp)}, ${lit(access)}, ${lit(refresh)}, ${lit(pk)}, ${expira}, ${live})`;
const credenciales = async (tutor) => (await q(`select * from public.mp_credentials where tutor_id = '${tutor}'`)).rows[0];
const cuentaPrivada = async (tutor) => (await q(`select mercadopago_account_id as c from public.tutor_private where id = '${tutor}'`)).rows[0]?.c;
const puedeCobrar = async (tutor) => (await q(`select public.tutor_can_receive_payments('${tutor}') as ok`)).rows[0].ok;
const cuenta = async (tabla) => Number((await q(`select count(*)::int as n from public.${tabla}`)).rows[0].n);

// docente2 es aprobado y no tiene cuenta de cobro (el seed solo le puso una al docente base).
await db.exec(`
  update public.tutor_profiles set verification_status = 'aprobado', tarifa_por_clase = 9000 where id = '${ids.docente2}';
  insert into auth.users (id, email, raw_user_meta_data) values ('${D3}', 'docente3@ejemplo.test', '{"full_name":"docente d3","role":"docente"}');
`);
let seq = 0;
const franja = async (tutor, dias = 20) => {
  seq++;
  await db.exec(`insert into public.availability_slots (id, tutor_id, starts_at, ends_at)
    values ('${S(seq)}', '${tutor}', now() + interval '${dias + seq} days', now() + interval '${dias + seq} days 1 hour')`);
  return S(seq);
};
const reservar = (who, slot) => as(db, who, async () => (await q(`select public.create_booking('${slot}') as id`)).rows[0].id);
const pagar = async (booking, mp, price = 9000) => {
  await as(db, "service", () => q(`select public.confirm_booking_payment('${booking}', '${mp}', ${price})`));
};
const limpiar = () => db.exec(`
  update public.bookings set status = 'cancelada' where status in ('pendiente_pago', 'confirmada');
  update public.availability_slots set is_booked = false;
  delete from public.refunds;`);

// =================================================================================================================
// 1. tutor_can_receive_payments
// =================================================================================================================
es("el docente base (con cuenta del seed) puede cobrar", await puedeCobrar(ids.docente), true);
es("un docente sin credenciales NO puede cobrar", await puedeCobrar(ids.docente2), false);
es("una cuenta de alumno NO", await puedeCobrar(ids.alumno), false);
es("un id que no existe NO", await puedeCobrar(NOEXISTE), false);
es("null NO", (await q(`select public.tutor_can_receive_payments(null) as ok`)).rows[0].ok, false);
{
  await db.exec(`update public.mp_credentials set expires_at = now() - interval '1 second' where tutor_id = '${ids.docente}'`);
  es("con las credenciales VENCIDAS no puede cobrar", await puedeCobrar(ids.docente), false);
  await db.exec(`update public.mp_credentials set expires_at = now() + interval '1 minute' where tutor_id = '${ids.docente}'`);
  es("a punto de vencer (en un minuto) todavía puede", await puedeCobrar(ids.docente), true);
  await db.exec(`update public.mp_credentials set expires_at = now() + interval '100 days' where tutor_id = '${ids.docente}'`);
}
// La puede ejecutar cualquiera (también sin sesión), pero eso no abre la tabla.
for (const who of ["anon", "alumno", "docente2", "admin", "service"]) {
  const got = await as(db, who, async () => (await q(`select public.tutor_can_receive_payments('${ids.docente}') as ok`)).rows[0].ok);
  r.push([got === true, `${who} puede preguntar si un docente cobra (solo recibe un sí o un no)`]);
}
await sinPermiso("...pero un visitante NO lee mp_credentials", "anon", `select tutor_id from public.mp_credentials`);

// =================================================================================================================
// 2. save_mp_credentials
// =================================================================================================================
// Feliz: un docente sin cuenta vincula la suya.
await as(db, "service", () => q(guardar(ids.docente2, "mp-d2")));
{
  const c = await credenciales(ids.docente2);
  r.push([c.mp_user_id === "mp-d2" && c.access_token === TOKEN_A && c.refresh_token === TOKEN_R && c.public_key === "APP_USR-pk" && c.live_mode === true,
    "guardar credenciales: queda la cuenta, los dos tokens, la clave pública y el modo"]);
  r.push([new Date(c.expires_at) > new Date(Date.now() + 99 * 86400000), "...con el vencimiento que informó Mercado Pago"]);
  es("...y fija tutor_private.mercadopago_account_id", await cuentaPrivada(ids.docente2), "mp-d2");
  es("...y ahora el docente puede cobrar", await puedeCobrar(ids.docente2), true);
}
// Repetir (upsert): reemplaza todo, no duplica.
await as(db, "service", () => q(guardar(ids.docente2, "mp-d2", { access: "acceso-2", refresh: "renov-2", pk: null, expira: "now() + interval '170 days'", live: false })));
{
  const c = await credenciales(ids.docente2);
  r.push([(await cuenta("mp_credentials")) === 2 && c.access_token === "acceso-2" && c.refresh_token === "renov-2" && c.public_key === null && c.live_mode === false &&
    new Date(c.expires_at) > new Date(Date.now() + 169 * 86400000), "guardar de nuevo la misma cuenta actualiza todo (no duplica la fila)"]);
}
// Cambiar a otra cuenta propia (sin plata en camino).
await as(db, "service", () => q(guardar(ids.docente2, "mp-d2-nueva")));
es("cambiar a otra cuenta propia actualiza las credenciales", (await credenciales(ids.docente2)).mp_user_id, "mp-d2-nueva");
es("...y tutor_private", await cuentaPrivada(ids.docente2), "mp-d2-nueva");

// Una cuenta de Mercado Pago ya vinculada a OTRO docente no se puede usar; no queda nada a medias.
{
  const antes = await credenciales(ids.docente2);
  await expectHint("la cuenta de otro docente", "service", guardar(ids.docente2, "seed-mp-d1", { access: "ladron", refresh: "ladron" }), "account_already_linked");
  const despues = await credenciales(ids.docente2);
  r.push([despues.mp_user_id === antes.mp_user_id && despues.access_token === antes.access_token && despues.refresh_token === antes.refresh_token &&
    (await cuentaPrivada(ids.docente2)) === "mp-d2-nueva" && (await credenciales(ids.docente)).access_token !== "ladron",
    "...y no cambió nada (ni las credenciales de este docente, ni las del otro, ni tutor_private)"]);
}
// Un docente sin credenciales previas tampoco puede quedarse con la cuenta de otro.
await expectHint("un docente sin cuenta intenta la del docente base", "service", guardar(D3, "seed-mp-d1"), "account_already_linked");
es("...y queda sin cuenta", [await credenciales(D3) ?? null, await cuentaPrivada(D3)], [null, null]);

// No es docente.
for (const [quien, id] of [["un alumno", ids.alumno], ["la administración", ids.admin], ["un id que no existe", NOEXISTE], ["null", null]]) {
  await expectHint(`guardar credenciales para ${quien}`, "service", guardar(id, "mp-x"), "not_a_tutor");
}
es("...no se creó ninguna fila", await cuenta("mp_credentials"), 2);
await expectHint("con un alumno Y datos inválidos gana not_a_tutor", "service", guardar(ids.alumno, "", { access: "" }), "not_a_tutor");

// Credenciales inválidas.
for (const [label, opts, mp] of [
  ["token de acceso vacío", { access: "" }, "mp-i"], ["token de acceso solo espacios", { access: "   " }, "mp-i"], ["token de acceso null", { access: null }, "mp-i"],
  ["token de renovación vacío", { refresh: "" }, "mp-i"], ["token de renovación null", { refresh: null }, "mp-i"],
  ["cuenta vacía", {}, ""], ["cuenta solo espacios", {}, "  "], ["cuenta null", {}, null],
  ["ya vencidas (ayer)", { expira: "now() - interval '1 day'" }, "mp-i"], ["vencen justo ahora", { expira: "now()" }, "mp-i"], ["sin vencimiento", { expira: "null" }, "mp-i"],
]) {
  await expectHint(`credenciales inválidas: ${label}`, "service", guardar(D3, mp, opts), "invalid_credentials");
}
es("...ninguna quedó guardada", [await credenciales(D3) ?? null, await cuentaPrivada(D3)], [null, null]);

// Guardar crea la fila privada si faltaba (caso borde) y fija la cuenta.
await db.exec(`delete from public.tutor_private where id = '${D3}'`);
await as(db, "service", () => q(guardar(D3, "mp-d3")));
es("si faltaba la fila de tutor_private, la crea con la cuenta", await cuentaPrivada(D3), "mp-d3");
es("...y las credenciales", (await credenciales(D3)).mp_user_id, "mp-d3");

// Solo el backend.
for (const who of ["anon", "alumno", "docente", "docente2", "admin"]) {
  await sinPermiso(`${who} NO ejecuta save_mp_credentials`, who, guardar(ids.docente2, "mp-hack"));
}
es("...y la cuenta del docente2 sigue siendo la suya", (await credenciales(ids.docente2)).mp_user_id, "mp-d2-nueva");

// =================================================================================================================
// 3. rotate_mp_tokens
// =================================================================================================================
const rotar = (tutor, access = "rotado-a", refresh = "rotado-r", expira = "now() + interval '150 days'") =>
  `select public.rotate_mp_tokens(${lit(tutor)}, ${lit(access)}, ${lit(refresh)}, ${expira})`;
{
  const antes = await credenciales(ids.docente2);
  await as(db, "service", () => q(rotar(ids.docente2)));
  const c = await credenciales(ids.docente2);
  r.push([c.access_token === "rotado-a" && c.refresh_token === "rotado-r" && new Date(c.expires_at) > new Date(Date.now() + 149 * 86400000), "rotar: quedan los tokens nuevos y el vencimiento nuevo"]);
  r.push([c.mp_user_id === antes.mp_user_id && c.public_key === antes.public_key && c.live_mode === antes.live_mode && (await cuentaPrivada(ids.docente2)) === "mp-d2-nueva",
    "...y NO cambia la cuenta, la clave pública ni el modo"]);
}
await expectHint("rotar los tokens de un docente que SÍ tiene credenciales anda", "service", rotar(ids.docente), null);
await db.exec(`delete from public.mp_credentials where tutor_id = '${D3}'`);
await expectHint("rotar sin credenciales: not_linked", "service", rotar(D3), "not_linked");
await expectHint("rotar para un alumno: not_linked", "service", rotar(ids.alumno), "not_linked");
await expectHint("rotar para un id que no existe: not_linked", "service", rotar(NOEXISTE), "not_linked");
for (const [label, args] of [
  ["acceso vacío", ["", "r", "now() + interval '1 day'"]], ["acceso null", [null, "r", "now() + interval '1 day'"]],
  ["renovación vacía", ["a", "  ", "now() + interval '1 day'"]], ["renovación null", ["a", null, "now() + interval '1 day'"]],
  ["vencidos", ["a", "r", "now() - interval '1 day'"]], ["vencen ahora", ["a", "r", "now()"]], ["sin vencimiento", ["a", "r", "null"]],
]) {
  await expectHint(`rotar con tokens inválidos: ${label}`, "service", rotar(ids.docente2, ...args), "invalid_credentials");
}
es("...y las credenciales quedaron como estaban", (await credenciales(ids.docente2)).access_token, "rotado-a");
for (const who of ["anon", "alumno", "docente2", "admin"]) await sinPermiso(`${who} NO ejecuta rotate_mp_tokens`, who, rotar(ids.docente2));

// =================================================================================================================
// 4. Lo que impide desvincular o cambiar de cuenta: plata en camino
// =================================================================================================================
//   Se prueba con las dos funciones a la vez: el docente desvincula (unlink_my_mp_account) o su cuenta se cambia por otra
//   (save_mp_credentials con otra cuenta). Mientras haya reservas por dar o reembolsos sin cerrar con la cuenta actual, ninguna.
const T = ids.docente2;
const ESCENARIOS = [
  ["una reserva pendiente de pago", async () => { await reservar("alumno", await franja(T)); }, "has_active_bookings"],
  ["una reserva confirmada que todavía no empezó", async () => { const b = await reservar("alumno", await franja(T)); await pagar(b, "mp-s2"); }, "has_active_bookings"],
  ["una reserva confirmada que YA empezó (la plata ya se cobró y la clase se dio)", async () => {
    const b = await reservar("alumno", await franja(T)); await pagar(b, "mp-s3");
    await db.exec(`update public.bookings set starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour' where id = '${b}'`);
  }, null],
  ["una reserva cancelada sin pago", async () => { const b = await reservar("alumno", await franja(T)); await as(db, "alumno", () => q(`select public.cancel_booking('${b}')`)); }, null],
  ["un reembolso pendiente de una reserva cancelada", async () => {
    const b = await reservar("alumno", await franja(T)); await pagar(b, "mp-s5"); await as(db, "docente2", () => q(`select public.cancel_booking('${b}')`));
  }, "has_pending_refunds"],
  ["un reembolso fallido", async () => {
    const b = await reservar("alumno", await franja(T)); await pagar(b, "mp-s6");
    const x = await as(db, "docente2", async () => (await q(`select public.cancel_booking('${b}') as r`)).rows[0].r);
    await as(db, "service", () => q(`select public.mark_refund_result('${x.refund.id}', 'fallido', null, 'sin respuesta')`));
  }, "has_pending_refunds"],
  ["un reembolso ya aprobado", async () => {
    const b = await reservar("alumno", await franja(T)); await pagar(b, "mp-s7");
    const x = await as(db, "docente2", async () => (await q(`select public.cancel_booking('${b}') as r`)).rows[0].r);
    await as(db, "service", () => q(`select public.mark_refund_result('${x.refund.id}', 'aprobado', 'mp-ref-s7')`));
  }, null],
  ["un reembolso pendiente sin reserva, de pagos que entraron a SU cuenta", async () => {
    await db.exec(`insert into public.refunds (mercadopago_payment_id, percent, amount, reason, mp_user_id) values ('mp-s8', 100, 100, 'pago_no_aceptable:prueba', 'mp-d2-nueva')`);
  }, "has_pending_refunds"],
  ["un reembolso pendiente sin reserva, de la cuenta de OTRO docente", async () => {
    await db.exec(`insert into public.refunds (mercadopago_payment_id, percent, amount, reason, mp_user_id) values ('mp-s9', 100, 100, 'pago_no_aceptable:prueba', 'seed-mp-d1')`);
  }, null],
  ["una reserva por dar de OTRO docente", async () => { const b = await reservar("alumno", await franja(ids.docente)); await pagar(b, "mp-s10", 10000); }, null],
  ["un reembolso pendiente de la reserva de OTRO docente", async () => {
    const b = await reservar("alumno", await franja(ids.docente)); await pagar(b, "mp-s11", 10000); await as(db, "docente", () => q(`select public.cancel_booking('${b}')`));
  }, null],
];
for (const [nombre, preparar, bloqueo] of ESCENARIOS) {
  await limpiar();
  await preparar();
  // a) Cambiar de cuenta (otra cuenta nueva) con save_mp_credentials.
  const cambio = await hintDe("service", guardar(T, "mp-d2-otra"));
  r.push([cambio === bloqueo, `cambiar de cuenta con ${nombre} → ${bloqueo ? "se rechaza" : "se puede"} (hint=${cambio})`]);
  if (!bloqueo) await as(db, "service", () => q(guardar(T, "mp-d2-nueva"))); // volver a la cuenta de antes
  // b) Renovar los permisos con la MISMA cuenta siempre se puede, haya lo que haya.
  const misma = await hintDe("service", guardar(T, "mp-d2-nueva", { access: "mismo-a", refresh: "mismo-r" }));
  r.push([misma === null, `vincular de nuevo la MISMA cuenta con ${nombre} siempre se puede (hint=${misma})`]);
  // c) Desvincular.
  const desvinculo = await hintDe("docente2", `select public.unlink_my_mp_account()`);
  r.push([desvinculo === bloqueo, `desvincular con ${nombre} → ${bloqueo ? "se rechaza" : "se puede"} (hint=${desvinculo})`]);
  if (bloqueo) {
    r.push([(await credenciales(T))?.mp_user_id === "mp-d2-nueva" && (await cuentaPrivada(T)) === "mp-d2-nueva" && (await puedeCobrar(T)) === true, "...y la cuenta sigue vinculada"]);
  } else {
    r.push([!(await credenciales(T)) && (await cuentaPrivada(T)) === null && (await puedeCobrar(T)) === false, "...y se borraron las credenciales y la cuenta de tutor_private"]);
    await as(db, "service", () => q(guardar(T, "mp-d2-nueva"))); // volver a vincular
  }
}
await limpiar();

// =================================================================================================================
// 5. unlink_my_mp_account: el resto de los casos
// =================================================================================================================
{
  // Feliz, y no toca a nadie más.
  const baseAntes = await credenciales(ids.docente);
  await as(db, "docente2", () => q(`select public.unlink_my_mp_account()`));
  r.push([!(await credenciales(ids.docente2)) && (await cuentaPrivada(ids.docente2)) === null, "el docente desvincula su cuenta: se borran las credenciales y queda sin cuenta en tutor_private"]);
  const baseDespues = await credenciales(ids.docente);
  r.push([baseDespues && baseDespues.mp_user_id === baseAntes.mp_user_id && baseDespues.access_token === baseAntes.access_token && (await puedeCobrar(ids.docente)),
    "...y no toca la cuenta de ningún otro docente"]);
  es("...ahora ese docente no puede cobrar", await puedeCobrar(ids.docente2), false);
  await expectHint("desvincular dos veces: not_linked", "docente2", `select public.unlink_my_mp_account()`, "not_linked");
  await expectHint("un alumno no tiene nada que desvincular: not_linked", "alumno", `select public.unlink_my_mp_account()`, "not_linked");
  await expectHint("la administración tampoco: not_linked", "admin", `select public.unlink_my_mp_account()`, "not_linked");
  await expectHint("sin sesión (service role): not_authenticated", "service", `select public.unlink_my_mp_account()`, "not_authenticated");
  await sinPermiso("un visitante NO ejecuta unlink_my_mp_account", "anon", `select public.unlink_my_mp_account()`);
  r.push([!!(await credenciales(ids.docente)), "ningún intento de otro rol desvinculó la cuenta del docente base"]);
}

// =================================================================================================================
// 6. create_booking exige un docente que pueda cobrar
// =================================================================================================================
{
  // docente2 acaba de desvincularse.
  const f1 = await franja(T);
  await expectHint("reservar con un docente SIN cuenta de cobro", "alumno", `select public.create_booking('${f1}')`, "tutor_not_payable");
  const sinReserva = (await q(`select (select count(*) from public.bookings where slot_id = '${f1}')::int as n, (select is_booked from public.availability_slots where id = '${f1}') as b`)).rows[0];
  r.push([sinReserva.n === 0 && sinReserva.b === false, "...no se crea la reserva ni se retiene el horario"]);

  await as(db, "service", () => q(guardar(T, "mp-d2-nueva")));
  const ok = await reservar("alumno", f1);
  r.push([!!ok, "con la cuenta vinculada y vigente, sí se puede reservar"]);
  await db.exec(`update public.bookings set status = 'cancelada' where id = '${ok}'; update public.availability_slots set is_booked = false where id = '${f1}'`);

  await db.exec(`update public.mp_credentials set expires_at = now() - interval '1 minute' where tutor_id = '${T}'`);
  await expectHint("reservar con las credenciales VENCIDAS", "alumno", `select public.create_booking('${f1}')`, "tutor_not_payable");
  await as(db, "service", () => q(rotar(T)));
  r.push([!!(await reservar("alumno", f1)), "al renovar los tokens vuelve a poder reservarse"]);
  await db.exec(`update public.bookings set status = 'cancelada' where slot_id = '${f1}'; update public.availability_slots set is_booked = false where id = '${f1}'`);

  // El orden de los controles: la cuenta de cobro se mira DESPUÉS de que el docente esté aprobado y ANTES del tope de reservas y de la superposición.
  await db.exec(`update public.mp_credentials set expires_at = now() - interval '1 minute' where tutor_id = '${T}'`);
  const fd3 = await franja(D3);
  await expectHint("un docente sin aprobar (y sin cuenta): tutor_unavailable primero", "alumno", `select public.create_booking('${fd3}')`, "tutor_unavailable");
  seq++;
  const fCerca = S(seq);
  await db.exec(`insert into public.availability_slots (id, tutor_id, starts_at, ends_at) values ('${fCerca}', '${T}', now() + interval '30 minutes', now() + interval '90 minutes')`);
  await expectHint("un horario que empieza en 30 minutos con un docente sin cuenta: slot_too_soon primero", "alumno", `select public.create_booking('${fCerca}')`, "slot_too_soon");
  await expectHint("un horario inexistente: slot_not_found primero", "alumno", `select public.create_booking('${NOEXISTE}')`, "slot_not_found");
  await expectHint("un docente no puede reservar: not_student primero", "docente", `select public.create_booking('${f1}')`, "not_student");
  // Con dos reservas sin pagar, el docente sin cuenta responde tutor_not_payable (no too_many_holds).
  const h1 = await reservar("alumno2", await franja(ids.docente));
  const h2 = await reservar("alumno2", await franja(ids.docente));
  r.push([!!h1 && !!h2, "(alumno2 retiene dos horarios del docente base)"]);
  await expectHint("con dos reservas sin pagar y un docente sin cuenta: tutor_not_payable antes que too_many_holds", "alumno2", `select public.create_booking('${f1}')`, "tutor_not_payable");
  const f3 = await franja(ids.docente);
  await expectHint("...y con un docente que cobra sí corre el tope: too_many_holds", "alumno2", `select public.create_booking('${f3}')`, "too_many_holds");
  await as(db, "service", () => q(rotar(T)));
  await limpiar();
}

// Los candados que ordenan una reserva nueva con vincular / desvincular (la carrera real no se reproduce con una sola conexión).
{
  const src = async (n) => (await q(`select prosrc from pg_proc where proname = '${n}' and pronamespace = 'public'::regnamespace`)).rows[0].prosrc;
  r.push([/pg_advisory_xact_lock_shared\(hashtext\('mp_account:'/.test(await src("create_booking")), "create_booking toma el candado compartido de la cuenta de cobro del docente"]);
  r.push([/pg_advisory_xact_lock\(hashtext\('mp_account:'/.test(await src("unlink_my_mp_account")), "unlink_my_mp_account toma el candado exclusivo"]);
  r.push([/pg_advisory_xact_lock\(hashtext\('mp_account:'/.test(await src("save_mp_credentials")), "save_mp_credentials toma el candado exclusivo"]);
  const orden = (await src("create_booking"));
  r.push([orden.indexOf("tutor_unavailable") < orden.indexOf("tutor_not_payable") && orden.indexOf("tutor_not_payable") < orden.indexOf("too_many_holds"),
    "en create_booking, tutor_not_payable va después de tutor_unavailable y antes de too_many_holds"]);
}

// =================================================================================================================
// 7. Los tokens no se pueden leer ni escribir desde ningún rol de la API
// =================================================================================================================
{
  await as(db, "service", () => q(guardar(T, "mp-d2-nueva", { access: TOKEN_A, refresh: TOKEN_R })));
  for (const who of ["anon", "alumno", "alumno2", "docente", "docente2", "admin"]) {
    await sinPermiso(`${who} NO lee access_token`, who, `select access_token from public.mp_credentials`);
    await sinPermiso(`${who} NO lee refresh_token`, who, `select refresh_token from public.mp_credentials`);
    await sinPermiso(`${who} NO lee la fila entera`, who, `select * from public.mp_credentials`);
    await sinPermiso(`${who} NO escribe tokens`, who, `update public.mp_credentials set access_token = 'x'`);
    await sinPermiso(`${who} NO crea credenciales`, who, `insert into public.mp_credentials (tutor_id, mp_user_id, access_token, refresh_token, expires_at) values ('${D3}', 'x', 'a', 'r', now() + interval '1 day')`);
    await sinPermiso(`${who} NO borra credenciales`, who, `delete from public.mp_credentials`);
  }
  // Ninguna otra tabla ni vista legible por la API tiene los tokens: solo mp_credentials tiene columnas de tokens y ahí no hay permiso.
  const columnas = (await q(`select table_name, column_name from information_schema.columns where table_schema = 'public' and column_name ~* 'token' order by 1, 2`)).rows;
  es("las únicas columnas de tokens están en mp_credentials", columnas.map((c) => `${c.table_name}.${c.column_name}`), ["mp_credentials.access_token", "mp_credentials.refresh_token"]);
  const abierto = (await q(`select has_column_privilege(r.rolname, 'public.mp_credentials', c.column_name, 'select') as ok, r.rolname, c.column_name
    from pg_roles r, (values ('access_token'), ('refresh_token')) as c(column_name) where r.rolname in ('anon', 'authenticated')`)).rows.filter((x) => x.ok);
  r.push([abierto.length === 0, "ni anon ni authenticated tienen permiso de lectura sobre las columnas de tokens"]);
  // Lo que sí lee el docente de lo suyo no incluye tokens.
  for (const [who, sql] of [["docente2", `select to_jsonb(t) as j from public.tutor_private t`], ["docente2", `select to_jsonb(t) as j from public.tutor_profiles t`], ["anon", `select to_jsonb(t) as j from public.tutor_catalog t`]]) {
    const filas = await as(db, who, async () => (await q(sql)).rows);
    const texto = JSON.stringify(filas);
    r.push([filas.length > 0 && !texto.includes(TOKEN_A) && !texto.includes(TOKEN_R), `lo que ${who} lee de ${sql.split("public.")[1].split(" ")[0]} no contiene tokens`]);
  }
  r.push([(await q(`select count(*)::int as n from public.mp_credentials`)).rows[0].n >= 2, "(el backend sí las tiene)"]);
}

report(r);
