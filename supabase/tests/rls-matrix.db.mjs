// Auditoría de la RLS: matriz completa tabla × operación × rol.
//
// Para cada tabla se prueba qué puede leer, crear, editar y borrar cada rol, sobre filas concretas
// (la propia, la de otra persona, la de un docente aprobado, la de uno pendiente...). Cada prueba
// declara QUIÉN debe poder; todos los demás deben quedar afuera. Si una migración abre o cierra un
// permiso sin querer, la matriz lo marca.
//
// Cada intento corre dentro de una transacción que siempre se deshace, así que los intentos no se
// pisan entre sí. "Puede" significa que la operación afectó o devolvió al menos una fila.
import { makeDb, ids } from "./harness.mjs";
import { seed } from "./seed.mjs";

const db = await makeDb();
await seed(db);

// --- Datos de la matriz -----------------------------------------------------------------------------
const A1 = ids.alumno; // tiene reservas con D1
const A2 = ids.alumno2; // sin relación con nadie
const D1 = ids.docente; // aprobado, con reservas de A1
const D2 = ids.docente2; // pendiente de aprobación
const AD = ids.admin;
const SLOT_FREE = "51000000-0000-0000-0000-000000000001"; // D1, libre (del seed)
const SLOT_BOOKED = "51000000-0000-0000-0000-000000000002"; // D1, reservado por A1 (B2)
const SLOT_D2 = "51000000-0000-0000-0000-0000000000d2"; // D2 (pendiente), libre
const SLOT_B4 = "51000000-0000-0000-0000-0000000000b4";
const B2 = "b0000000-0000-0000-0000-000000000002"; // A1-D1 confirmada (del seed)
const B3 = "b0000000-0000-0000-0000-000000000003"; // A1-D1 completada (del seed)
const B4 = "b0000000-0000-0000-0000-000000000004"; // A1-D1 completada, sin calificar
const P2 = "e0000000-0000-0000-0000-000000000002";
const W1 = "e1000000-0000-0000-0000-000000000001";
const V2 = "e2000000-0000-0000-0000-000000000002";
const R3 = "e3000000-0000-0000-0000-000000000003";
const RF = "e4000000-0000-0000-0000-000000000004";
const NEW_ID = "99999999-9999-9999-9999-999999999999";

await db.exec(`
  insert into public.availability_slots (id, tutor_id, starts_at, ends_at, is_booked) values
    ('${SLOT_D2}', '${D2}', now() + interval '5 days', now() + interval '5 days 1 hour', false),
    ('${SLOT_B4}', '${D1}', now() - interval '9 days', now() - interval '9 days' + interval '1 hour', true);
  insert into public.bookings (id, student_id, tutor_id, slot_id, status, starts_at, ends_at, price)
    select '${B4}', '${A1}', '${D1}', id, 'completada', starts_at, ends_at, 10000
    from public.availability_slots where id = '${SLOT_B4}';
  insert into public.payments (id, booking_id, status, amount, commission_amount, tutor_amount)
    values ('${P2}', '${B2}', 'aprobado', 10000, 1000, 9000);
  insert into public.payment_webhook_events (id, mercadopago_event_id, payload)
    values ('${W1}', 'evt-1', '{"x":1}');
  insert into public.video_rooms (id, booking_id, room_url) values ('${V2}', '${B2}', 'https://sala.test/x');
  insert into public.ratings (id, booking_id, student_id, tutor_id, score)
    values ('${R3}', '${B3}', '${A1}', '${D1}', 5);
  insert into public.refunds (id, booking_id, payment_id, mercadopago_payment_id, percent, amount, reason)
    values ('${RF}', '${B2}', '${P2}', 'mp-rf1', 100, 10000, 'prueba');
  insert into public.mp_credentials (tutor_id, mp_user_id, access_token, refresh_token, expires_at)
    values ('${D1}', '555', 'cifrado-a', 'cifrado-r', now() + interval '180 days');
  update public.tutor_private set contacto_verificacion = 'c1', mercadopago_account_id = 'mp1' where id = '${D1}';
  update public.tutor_private set contacto_verificacion = 'c2' where id = '${D2}';
`);

// Para comprobar que la matriz detecta un permiso abierto: MATRIX_SABOTAJE="<SQL>" npm run test:db -- matrix
// (por ejemplo, una política que deje leer pagos a cualquiera). Tiene que terminar con FALLAS.
if (process.env.MATRIX_SABOTAJE) await db.exec(process.env.MATRIX_SABOTAJE);

// --- Actores ---------------------------------------------------------------------------------------------
const ACTORS = ["anon", "alumno", "alumno2", "docente", "docente2", "admin", "service"];
const WHO = { anon: "", service: "", alumno: A1, alumno2: A2, docente: D1, docente2: D2, admin: AD };
const ROLE = { anon: "anon", service: "service_role" };
const ALL = ACTORS;

async function attempt(actor, sql) {
  await db.exec("begin");
  let allowed = false;
  try {
    await db.exec(
      `select set_config('request.jwt.claim.sub', '${WHO[actor]}', true); set local role ${ROLE[actor] ?? "authenticated"};`,
    );
    const r = await db.query(sql);
    allowed = (r.rows?.length ?? 0) > 0 || (r.affectedRows ?? 0) > 0;
  } catch {
    allowed = false;
  } finally {
    await db.exec("rollback");
  }
  return allowed;
}

// --- Las pruebas -----------------------------------------------------------------------------------------------
const probes = [];
const P = (tabla, op, descripcion, sql, puede) => probes.push({ tabla, op, descripcion, sql, puede });

// profiles
P("profiles", "leer", "perfil de un alumno con reserva con D1", `select id from public.profiles where id='${A1}'`, ["alumno", "docente", "admin", "service"]);
P("profiles", "leer", "perfil de un alumno sin relación con D1", `select id from public.profiles where id='${A2}'`, ["alumno2", "admin", "service"]);
P("profiles", "leer", "perfil de un docente aprobado (público)", `select id from public.profiles where id='${D1}'`, ALL);
P("profiles", "leer", "perfil de un docente pendiente", `select id from public.profiles where id='${D2}'`, ["docente2", "admin", "service"]);
P("profiles", "leer", "perfil de la administración", `select id from public.profiles where id='${AD}'`, ["admin", "service"]);
P("profiles", "editar", "nombre de A1", `update public.profiles set full_name='x' where id='${A1}' returning id`, ["alumno", "admin", "service"]);
P("profiles", "editar", "nombre de A2", `update public.profiles set full_name='x' where id='${A2}' returning id`, ["alumno2", "admin", "service"]);
P("profiles", "editar", "rol de A1 a administrador", `update public.profiles set role='administrador' where id='${A1}' returning id`, ["admin", "service"]);
P("profiles", "editar", "rol de A2 a docente", `update public.profiles set role='docente' where id='${A2}' returning id`, ["admin", "service"]);
P("profiles", "crear", "perfil de otra persona", `insert into public.profiles (id, role) values ('${NEW_ID}', 'administrador') returning id`, []);
P("profiles", "borrar", "perfil de A2", `delete from public.profiles where id='${A2}' returning id`, ["service"]);

// tutor_profiles
P("tutor_profiles", "leer", "docente aprobado (público)", `select id from public.tutor_profiles where id='${D1}'`, ALL);
P("tutor_profiles", "leer", "docente pendiente", `select id from public.tutor_profiles where id='${D2}'`, ["docente2", "admin", "service"]);
P("tutor_profiles", "editar", "biografía de D1", `update public.tutor_profiles set bio='x' where id='${D1}' returning id`, ["docente", "admin", "service"]);
P("tutor_profiles", "editar", "biografía de D2", `update public.tutor_profiles set bio='x' where id='${D2}' returning id`, ["docente2", "admin", "service"]);
P("tutor_profiles", "editar", "estado de D2 a aprobado", `update public.tutor_profiles set verification_status='aprobado' where id='${D2}' returning id`, ["admin", "service"]);
P("tutor_profiles", "editar", "estado de D1 a rechazado", `update public.tutor_profiles set verification_status='rechazado', verification_reason='x' where id='${D1}' returning id`, ["admin", "service"]);
P("tutor_profiles", "editar", "calificación de D1", `update public.tutor_profiles set rating_promedio=1 where id='${D1}' returning id`, ["admin", "service"]);
P("tutor_profiles", "crear", "perfil de docente para una cuenta de alumno (A2)", `insert into public.tutor_profiles (id) values ('${A2}') returning id`, ["service"]);
P("tutor_profiles", "borrar", "perfil de D1", `delete from public.tutor_profiles where id='${D1}' returning id`, ["service"]);

// tutor_private
P("tutor_private", "leer", "datos privados de D1", `select id from public.tutor_private where id='${D1}'`, ["docente", "admin", "service"]);
P("tutor_private", "leer", "datos privados de D2", `select id from public.tutor_private where id='${D2}'`, ["docente2", "admin", "service"]);
P("tutor_private", "editar", "contacto de D1", `update public.tutor_private set contacto_verificacion='x' where id='${D1}' returning id`, ["docente", "service"]);
P("tutor_private", "editar", "cuenta de Mercado Pago de D1", `update public.tutor_private set mercadopago_account_id='x' where id='${D1}' returning id`, ["service"]);
P("tutor_private", "crear", "(upsert) datos de D2", `insert into public.tutor_private (id, contacto_verificacion) values ('${D2}', 'x') on conflict (id) do update set contacto_verificacion=excluded.contacto_verificacion returning id`, ["docente2", "service"]);
P("tutor_private", "crear", "(upsert) con cuenta de Mercado Pago", `insert into public.tutor_private (id, mercadopago_account_id) values ('${D2}', 'x') on conflict (id) do update set mercadopago_account_id=excluded.mercadopago_account_id returning id`, ["service"]);
P("tutor_private", "borrar", "datos de D1", `delete from public.tutor_private where id='${D1}' returning id`, ["service"]);

// subjects
P("subjects", "leer", "catálogo de materias", `select id from public.subjects limit 1`, ALL);
P("subjects", "crear", "una materia", `insert into public.subjects (name) values ('Nueva materia') returning id`, ["admin", "service"]);
P("subjects", "editar", "una materia", `update public.subjects set name='Otra' where name='Matemática' returning id`, ["admin", "service"]);
P("subjects", "borrar", "una materia", `delete from public.subjects where name='Física' returning id`, ["admin", "service"]);

// tutor_subjects
P("tutor_subjects", "leer", "materias de D1 (aprobado)", `select tutor_id from public.tutor_subjects where tutor_id='${D1}'`, ALL);
P("tutor_subjects", "leer", "materias de D2 (pendiente)", `select tutor_id from public.tutor_subjects where tutor_id='${D2}'`, ["docente2", "admin", "service"]);
P("tutor_subjects", "crear", "materia para D1", `insert into public.tutor_subjects (tutor_id, subject_id) select '${D1}', id from public.subjects where name='Química' returning tutor_id`, ["docente", "service"]);
P("tutor_subjects", "crear", "materia para D2", `insert into public.tutor_subjects (tutor_id, subject_id) select '${D2}', id from public.subjects where name='Química' returning tutor_id`, ["docente2", "service"]);
P("tutor_subjects", "borrar", "materias de D1", `delete from public.tutor_subjects where tutor_id='${D1}' returning tutor_id`, ["docente", "service"]);

// availability_slots
P("availability_slots", "leer", "franja libre de un docente aprobado", `select id from public.availability_slots where id='${SLOT_FREE}'`, ALL);
P("availability_slots", "leer", "franja reservada por A1", `select id from public.availability_slots where id='${SLOT_BOOKED}'`, ["alumno", "docente", "admin", "service"]);
P("availability_slots", "leer", "franja libre de un docente pendiente", `select id from public.availability_slots where id='${SLOT_D2}'`, ["docente2", "admin", "service"]);
P("availability_slots", "crear", "franja para D1", `insert into public.availability_slots (tutor_id, starts_at, ends_at) values ('${D1}', now() + interval '30 days', now() + interval '30 days 1 hour') returning id`, ["docente", "service"]);
P("availability_slots", "crear", "franja para D2", `insert into public.availability_slots (tutor_id, starts_at, ends_at) values ('${D2}', now() + interval '30 days', now() + interval '30 days 1 hour') returning id`, ["docente2", "service"]);
P("availability_slots", "editar", "franja libre de D1", `update public.availability_slots set ends_at = ends_at + interval '30 minutes' where id='${SLOT_FREE}' returning id`, ["docente", "service"]);
P("availability_slots", "editar", "marcar una franja libre como reservada", `update public.availability_slots set is_booked = true where id='${SLOT_FREE}' returning id`, ["service"]); // el docente no puede reservarse a sí mismo una franja
P("availability_slots", "editar", "franja reservada", `update public.availability_slots set ends_at = ends_at + interval '30 minutes' where id='${SLOT_BOOKED}' returning id`, ["service"]);
P("availability_slots", "borrar", "franja libre de D1", `delete from public.availability_slots where id='${SLOT_FREE}' returning id`, ["docente", "service"]);
P("availability_slots", "borrar", "franja reservada", `delete from public.availability_slots where id='${SLOT_BOOKED}' returning id`, ["service"]);

// bookings
P("bookings", "leer", "reserva de A1 con D1", `select id from public.bookings where id='${B2}'`, ["alumno", "docente", "admin", "service"]);
P("bookings", "crear", "una reserva ya confirmada", `insert into public.bookings (student_id, tutor_id, slot_id, status, starts_at, ends_at) select '${A2}', '${D1}', id, 'confirmada', starts_at, ends_at from public.availability_slots where id='${SLOT_FREE}' returning id`, ["service"]);
P("bookings", "editar", "estado de la reserva", `update public.bookings set status='completada' where id='${B2}' returning id`, ["service"]);
P("bookings", "editar", "docente de la reserva", `update public.bookings set tutor_id='${D2}' where id='${B2}' returning id`, ["service"]);
P("bookings", "borrar", "una reserva", `delete from public.bookings where id='${B2}' returning id`, ["service"]);

// payments
P("payments", "leer", "pago de la reserva de A1 con D1", `select id from public.payments where id='${P2}'`, ["alumno", "docente", "admin", "service"]);
P("payments", "crear", "un pago", `insert into public.payments (booking_id, status, amount) values ('${B4}', 'aprobado', 1) returning id`, ["service"]);
P("payments", "editar", "un pago", `update public.payments set amount = 1 where id='${P2}' returning id`, ["service"]);
P("payments", "borrar", "un pago", `delete from public.payments where id='${P2}' returning id`, ["service"]);

// payment_webhook_events
P("payment_webhook_events", "leer", "eventos de Mercado Pago", `select id from public.payment_webhook_events`, ["service"]);
P("payment_webhook_events", "crear", "un evento", `insert into public.payment_webhook_events (mercadopago_event_id, payload) values ('evt-2', '{}') returning id`, ["service"]);
P("payment_webhook_events", "editar", "un evento", `update public.payment_webhook_events set payload='{}' where id='${W1}' returning id`, ["service"]);
P("payment_webhook_events", "borrar", "un evento", `delete from public.payment_webhook_events where id='${W1}' returning id`, ["service"]);

// video_rooms
P("video_rooms", "leer", "sala de la reserva de A1 con D1", `select id from public.video_rooms where id='${V2}'`, ["alumno", "docente", "service"]);
P("video_rooms", "crear", "una sala", `insert into public.video_rooms (booking_id, room_url) values ('${B4}', 'https://x.test') returning id`, ["service"]);
P("video_rooms", "editar", "una sala", `update public.video_rooms set room_url='https://otra.test' where id='${V2}' returning id`, ["service"]);
P("video_rooms", "borrar", "una sala", `delete from public.video_rooms where id='${V2}' returning id`, ["service"]);

// ratings
P("ratings", "leer", "calificación de un docente aprobado (público)", `select id from public.ratings where id='${R3}'`, ALL);
P("ratings", "crear", "calificar una clase completada propia (A1 → D1)", `insert into public.ratings (booking_id, student_id, tutor_id, score) values ('${B4}', '${A1}', '${D1}', 4) returning id`, ["alumno", "service"]);
P("ratings", "crear", "calificar a otro docente con una clase ajena (A1 → D2)", `insert into public.ratings (booking_id, student_id, tutor_id, score) values ('${B4}', '${A1}', '${D2}', 1) returning id`, ["service"]);
P("ratings", "crear", "calificar una clase que no está completada", `insert into public.ratings (booking_id, student_id, tutor_id, score) values ('${B2}', '${A1}', '${D1}', 1) returning id`, ["service"]);
P("ratings", "editar", "una calificación", `update public.ratings set score = 1 where id='${R3}' returning id`, ["service"]);
P("ratings", "borrar", "una calificación", `delete from public.ratings where id='${R3}' returning id`, ["service"]);

// refunds (0011)
P("refunds", "leer", "reembolso de la reserva de A1 con D1", `select id from public.refunds where id='${RF}'`, ["alumno", "docente", "admin", "service"]);
P("refunds", "crear", "un reembolso", `insert into public.refunds (mercadopago_payment_id, percent, amount, reason) values ('mp-nuevo', 100, 1, 'x') returning id`, ["service"]);
P("refunds", "editar", "marcar un reembolso como aprobado", `update public.refunds set status='aprobado' where id='${RF}' returning id`, ["service"]);
P("refunds", "borrar", "un reembolso", `delete from public.refunds where id='${RF}' returning id`, ["service"]);

// mp_credentials (0011): los tokens de Mercado Pago solo los toca el backend
P("mp_credentials", "leer", "tokens de D1 (ni el propio docente)", `select tutor_id from public.mp_credentials`, ["service"]);
P("mp_credentials", "crear", "tokens para D2", `insert into public.mp_credentials (tutor_id, mp_user_id, access_token, refresh_token, expires_at) values ('${D2}', '777', 'a', 'r', now()) returning tutor_id`, ["service"]);
P("mp_credentials", "editar", "el token de D1", `update public.mp_credentials set access_token='x' where tutor_id='${D1}' returning tutor_id`, ["service"]);
P("mp_credentials", "borrar", "los tokens de D1", `delete from public.mp_credentials where tutor_id='${D1}' returning tutor_id`, ["service"]);

// tutor_catalog (vista)
P("tutor_catalog", "leer", "catálogo público de docentes", `select id from public.tutor_catalog where id='${D1}'`, ALL);
P("tutor_catalog", "leer", "un docente pendiente NO aparece", `select id from public.tutor_catalog where id='${D2}'`, []);

// --- Ejecución ---------------------------------------------------------------------------------------------------
const resultados = [];
for (const probe of probes) {
  const esperado = new Set(probe.puede);
  const diferencias = [];
  for (const actor of ACTORS) {
    const real = await attempt(actor, probe.sql);
    if (real !== esperado.has(actor)) {
      diferencias.push(`${actor}: ${real ? "PUDO" : "no pudo"} (se esperaba que ${esperado.has(actor) ? "pudiera" : "no pudiera"})`);
    }
  }
  resultados.push([diferencias.length === 0, `${probe.tabla} · ${probe.op} · ${probe.descripcion}${diferencias.length ? "\n        → " + diferencias.join("; ") : ""}`]);
}

// --- Toda tabla de public tiene la RLS activada ----------------------------------------------------------------
const tablas = (await db.query(`
  select c.relname, c.relrowsecurity
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' order by 1`)).rows;
for (const t of tablas) resultados.push([t.relrowsecurity === true, `RLS activada en public.${t.relname}`]);

// --- Quién puede ejecutar cada función ---------------------------------------------------------------------------------
const FUNCIONES = [
  // service_role conserva el permiso por defecto de Supabase; sin sesión las dos fallan con `not_authenticated`.
  ["public.create_booking(uuid)", ["authenticated", "service_role"]],
  ["public.cancel_booking(uuid, text)", ["authenticated", "service_role"]],
  ["public.sync_bookings()", ["anon", "authenticated", "service_role"]],
  ["public.confirm_booking_payment(uuid, text, numeric, numeric)", ["service_role"]],
  ["public.mark_refund_result(uuid, refund_status, text, text)", ["service_role"]],
  ["public.begin_payment_event(text, jsonb)", ["service_role"]],
  ["public.finish_payment_event(text, text)", ["service_role"]],
  ["public.commission_rate_for(uuid)", ["authenticated", "service_role"]],
  ["public.booking_commission(numeric, numeric)", ["authenticated", "service_role"]],
  ["public.refund_percent(timestamptz, timestamptz, boolean)", ["authenticated", "service_role"]],
];
for (const [fn, permitidos] of FUNCIONES) {
  for (const rol of ["anon", "authenticated", "service_role"]) {
    const real = (await db.query(`select has_function_privilege('${rol}', '${fn}', 'execute') as ok`)).rows[0].ok;
    resultados.push([real === permitidos.includes(rol), `${fn} · ${rol} ${permitidos.includes(rol) ? "puede" : "NO puede"} ejecutarla`]);
  }
}

// --- Informe ------------------------------------------------------------------------------------------------------------------
let mal = 0;
for (const [ok, msg] of resultados) {
  if (!ok) mal++;
  console.log(ok ? "ok   " : "FAIL ", msg);
}
console.log(
  mal
    ? `\n${mal} FALLARON de ${resultados.length} (${probes.length} pruebas × ${ACTORS.length} roles, más tablas y funciones)`
    : `\nTodas pasaron (${resultados.length}: ${probes.length} pruebas × ${ACTORS.length} roles = ${probes.length * ACTORS.length} intentos, más tablas y funciones)`,
);
process.exitCode = mal ? 1 : 0;
