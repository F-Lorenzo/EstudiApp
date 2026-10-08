// Camino de actualización: un proyecto de Supabase real ya tiene las migraciones 0001 a 0005 y
// DATOS. Las migraciones 0006 a 0010 se aplican encima, en orden, y no pueden perder ni deformar
// lo que ya hay. Esta prueba arma una base "vieja" con datos realistas, aplica las cinco y
// comprueba que todo sigue ahí, con los campos nuevos completos.
import { makeDb, applyMigration, as, ids, report } from "./harness.mjs";

const r = [];
const q = (db, sql) => db.query(sql);

// --- Una base con las migraciones 0001 a 0005 y datos de un proyecto en uso ---------------------------------
async function baseVieja() {
  const db = await makeDb({ upTo: 5 });
  await db.exec(`
    insert into auth.users (id, raw_user_meta_data) values
      ('${ids.alumno}', '{"full_name":"Alumna Uno","role":"alumno"}'),
      ('${ids.alumno2}', '{"full_name":"Alumno Dos","role":"alumno"}'),
      ('${ids.docente}', '{"full_name":"Docente Aprobada","role":"docente"}'),
      ('${ids.docente2}', '{"full_name":"Docente Pendiente","role":"docente"}'),
      ('${ids.admin}', '{"full_name":"Admin","role":"alumno"}');
    update public.profiles set role = 'administrador' where id = '${ids.admin}';
    update public.tutor_profiles
      set verification_status = 'aprobado', bio = 'Bio D1', tarifa_por_clase = 12000,
          contacto_verificacion = '+54 9 11 5555-0001', credential_url = 'https://ejemplo.test/t.pdf',
          mercadopago_account_id = 'mp-d1', rating_promedio = 4.5
      where id = '${ids.docente}';
    update public.tutor_profiles
      set bio = 'Bio D2', tarifa_por_clase = 9000, contacto_verificacion = 'd2@ejemplo.test'
      where id = '${ids.docente2}';
    insert into public.tutor_subjects (tutor_id, subject_id)
      select '${ids.docente}', id from public.subjects where name in ('Matemática', 'Física');

    insert into public.availability_slots (id, tutor_id, starts_at, ends_at, is_booked) values
      ('51000000-0000-0000-0000-000000000a01', '${ids.docente}', now() + interval '2 days', now() + interval '2 days 1 hour', true),
      ('51000000-0000-0000-0000-000000000a02', '${ids.docente}', now() + interval '3 days', now() + interval '3 days 1 hour', true),
      ('51000000-0000-0000-0000-000000000a03', '${ids.docente}', now() + interval '4 days', now() + interval '4 days 1 hour', false),
      ('51000000-0000-0000-0000-000000000a04', '${ids.docente}', now() - interval '10 days', now() - interval '10 days' + interval '1 hour', true),
      ('51000000-0000-0000-0000-000000000a05', '${ids.docente}', now() - interval '3 days', now() - interval '3 days' + interval '1 hour', true);

    -- Antes de la 0008 la reserva no guardaba su horario ni su precio.
    insert into public.bookings (id, student_id, tutor_id, slot_id, status, created_at) values
      ('b0000000-0000-0000-0000-00000000a001', '${ids.alumno}', '${ids.docente}', '51000000-0000-0000-0000-000000000a01', 'pendiente_pago', now() - interval '2 days'),
      ('b0000000-0000-0000-0000-00000000a002', '${ids.alumno}', '${ids.docente}', '51000000-0000-0000-0000-000000000a02', 'confirmada', now() - interval '1 day'),
      ('b0000000-0000-0000-0000-00000000a004', '${ids.alumno}', '${ids.docente}', '51000000-0000-0000-0000-000000000a04', 'completada', now() - interval '11 days'),
      ('b0000000-0000-0000-0000-00000000a005', '${ids.alumno2}', '${ids.docente}', '51000000-0000-0000-0000-000000000a05', 'cancelada', now() - interval '4 days');
    insert into public.payments (booking_id, status, amount, commission_amount, tutor_amount) values
      ('b0000000-0000-0000-0000-00000000a002', 'aprobado', 12000, 1200, 10800),
      ('b0000000-0000-0000-0000-00000000a004', 'aprobado', 12000, 1200, 10800);
    insert into public.ratings (booking_id, student_id, tutor_id, score, comment)
      values ('b0000000-0000-0000-0000-00000000a004', '${ids.alumno}', '${ids.docente}', 5, 'Muy buena');
  `);
  return db;
}

const antes = await baseVieja();
const contar = async (db) =>
  (await q(db, `select
      (select count(*) from public.profiles)::int as perfiles,
      (select count(*) from public.tutor_profiles)::int as docentes,
      (select count(*) from public.availability_slots)::int as franjas,
      (select count(*) from public.bookings)::int as reservas,
      (select count(*) from public.payments)::int as pagos,
      (select count(*) from public.ratings)::int as calificaciones,
      (select count(*) from public.tutor_subjects)::int as materias`)).rows[0];
const conteoAntes = await contar(antes);

// --- Se aplican 0006 a 0010 en orden, una por una -------------------------------------------------------------------
let falla = null;
for (const n of [6, 7, 8, 9, 10]) {
  try {
    await applyMigration(antes, n);
    r.push([true, `la migración ${String(n).padStart(4, "0")} se aplica sobre datos existentes`]);
  } catch (e) {
    falla = e.message;
    r.push([false, `la migración ${n} falló sobre datos existentes: ${e.message.slice(0, 150)}`]);
    break;
  }
}

if (!falla) {
  const conteoDespues = await contar(antes);
  r.push([JSON.stringify(conteoAntes) === JSON.stringify(conteoDespues), `no se pierde ni se duplica ninguna fila (${JSON.stringify(conteoDespues)})`]);

  // 0008: la reserva copia el horario de su franja; el precio queda sin dato en las viejas.
  const res = (await q(antes, `select b.id, b.starts_at = s.starts_at and b.ends_at = s.ends_at as igual, b.price from public.bookings b join public.availability_slots s on s.id = b.slot_id`)).rows;
  r.push([res.length === 4 && res.every((x) => x.igual), "cada reserva copió el horario de su franja"]);
  r.push([res.every((x) => x.price === null), "las reservas viejas quedan sin precio (no se inventa uno)"]);

  // 0010: los datos privados se copiaron.
  const priv = (await q(antes, `select * from public.tutor_private where id = '${ids.docente}'`)).rows[0];
  r.push([priv?.contacto_verificacion === "+54 9 11 5555-0001" && priv.credential_url === "https://ejemplo.test/t.pdf" && priv.mercadopago_account_id === "mp-d1", "el contacto, el respaldo y la cuenta de cobro del docente se copiaron a tutor_private"]);
  const priv2 = (await q(antes, `select contacto_verificacion from public.tutor_private where id = '${ids.docente2}'`)).rows[0];
  r.push([priv2?.contacto_verificacion === "d2@ejemplo.test", "...también los del docente pendiente"]);

  // Lo que ya estaba sigue valiendo.
  const d1 = (await q(antes, `select verification_status, tarifa_por_clase, rating_promedio from public.tutor_profiles where id = '${ids.docente}'`)).rows[0];
  r.push([d1.verification_status === "aprobado" && Number(d1.tarifa_por_clase) === 12000 && Number(d1.rating_promedio) === 4.5, "el estado, la tarifa y la calificación del docente no cambiaron"]);
  const admin = (await q(antes, `select role from public.profiles where id = '${ids.admin}'`)).rows[0];
  r.push([admin.role === "administrador", "el administrador sigue siendo administrador"]);

  // Con la base nueva, las reglas nuevas rigen sobre los datos viejos.
  await as(antes, "alumno", async () => {
    const x = await q(antes, `select public.sync_bookings() as n`);
    r.push([x.rows[0].n === 1, `sync_bookings cancela la reserva sin pagar de hace 2 días y libera su franja (${x.rows[0].n})`]);
  });
  const vieja = (await q(antes, `select b.status, s.is_booked from public.bookings b join public.availability_slots s on s.id = b.slot_id where b.id = 'b0000000-0000-0000-0000-00000000a001'`)).rows[0];
  r.push([vieja.status === "cancelada" && vieja.is_booked === false, "esa reserva quedó cancelada y su franja libre"]);
  const completada = (await q(antes, `select status from public.bookings where id = 'b0000000-0000-0000-0000-00000000a002'`)).rows[0];
  r.push([completada.status === "confirmada", "la reserva confirmada y paga que todavía no ocurrió sigue confirmada"]);

  await as(antes, "anon", async () => {
    try {
      await q(antes, `select * from public.tutor_private`);
      r.push([false, "un visitante no debería poder leer tutor_private"]);
    } catch {
      r.push([true, "un visitante no puede leer los datos privados migrados"]);
    }
  });
}

// --- El caso que hay que revisar a mano antes de aplicar: franjas duplicadas ----------------------------------------------
{
  const db = await baseVieja();
  await db.exec(`
    insert into public.availability_slots (tutor_id, starts_at, ends_at)
    select tutor_id, starts_at, ends_at from public.availability_slots where id = '51000000-0000-0000-0000-000000000a03'
  `);
  await applyMigration(db, 6);
  let msg = null;
  try {
    await applyMigration(db, 7);
  } catch (e) {
    msg = e.message;
  }
  r.push([msg !== null && /duplicadas|duplicate|unique|availability_slots_tutor_start_key/i.test(msg), "con franjas duplicadas la 0007 FALLA (hay que dejar una por docente y hora, como indica la migración)"]);
  await db.exec(`
    delete from public.availability_slots a using public.availability_slots b
    where a.tutor_id = b.tutor_id and a.starts_at = b.starts_at and a.ctid > b.ctid
  `);
  let ok = true;
  try {
    for (const n of [7, 8, 9, 10]) await applyMigration(db, n);
  } catch {
    ok = false;
  }
  r.push([ok, "...y una vez sin duplicados, 0007 a 0010 se aplican"]);
}

// --- Las reservas "confirmadas" sin pago son un resto del hueco anterior a la 0008 ---------------------------------------
{
  const db = await baseVieja();
  await db.exec(`update public.bookings set status = 'confirmada' where id = 'b0000000-0000-0000-0000-00000000a001'`);
  const sospechosas = (await q(db, `
    select b.id from public.bookings b
    where b.status in ('confirmada', 'completada')
      and not exists (select 1 from public.payments p where p.booking_id = b.id and p.status = 'aprobado')`)).rows;
  r.push([sospechosas.length === 1, "la consulta de control detecta una reserva confirmada sin pago aprobado (ver supabase/README.md)"]);
}

// --- El archivo único (npm run db:bundle) --------------------------------------------------------------------------------
{
  const { spawnSync } = await import("node:child_process");
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const gen = spawnSync(process.execPath, ["scripts/bundle-migrations.mjs"], { cwd: root, encoding: "utf8" });
  r.push([gen.status === 0, "npm run db:bundle genera el archivo único"]);
  const sql = readFileSync(fileURLToPath(new URL("../aplicar-0006-a-0010.sql", import.meta.url)), "utf8");

  const ok = await baseVieja();
  let aplicado = true;
  try { await ok.exec(sql); } catch (e) { aplicado = false; console.log(e.message); }
  const tablas = (await q(ok, `select to_regclass('public.tutor_private') as t`)).rows[0].t;
  r.push([aplicado && tablas !== null, "el archivo único se aplica de una vez sobre una base vieja con datos"]);

  // Si algo falla, no queda nada a medias (se usa una base con franjas duplicadas).
  const mal = await baseVieja();
  await mal.exec(`insert into public.availability_slots (tutor_id, starts_at, ends_at)
    select tutor_id, starts_at, ends_at from public.availability_slots where id = '51000000-0000-0000-0000-000000000a03'`);
  let fallo = false;
  try { await mal.exec(sql); } catch { fallo = true; }
  await mal.exec("rollback");
  const trigger = (await q(mal, `select count(*)::int as n from pg_trigger where tgname = 'profiles_protect_role'`)).rows[0].n;
  const tabla = (await q(mal, `select to_regclass('public.tutor_private') as t`)).rows[0].t;
  r.push([fallo && trigger === 0 && tabla === null, "si el archivo falla (franjas duplicadas) no queda ninguna migración a medias"]);
}

report(r);
