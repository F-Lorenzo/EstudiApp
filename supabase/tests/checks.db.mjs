// Las consultas de supabase/checks se pegan en el SQL Editor de un proyecto real, en cualquier
// estado. Esta prueba las corre en cada estado posible (vacío, 0001-0005, mezclado, completo) y
// comprueba que no fallen y que digan lo correcto.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { applyMigration, makeDb, report } from "./harness.mjs";
import { seed } from "./seed.mjs";

const r = [];
const read = (name) => fs.readFileSync(fileURLToPath(new URL(`../checks/${name}`, import.meta.url)), "utf8");
const DIAGNOSTICO = read("1-diagnostico.sql");
const VERIFICACION = read("2-verificacion.sql");

async function correr(db, sql) {
  const results = await db.exec(sql);
  return results[results.length - 1].rows;
}

// --- Diagnóstico en cada estado ------------------------------------------------------------------------
const TODAS = ["0001", "0002", "0003", "0004", "0005", "0006", "0007", "0008", "0009", "0010", "0011", "0012", "0013", "0014", "0015", "0016", "0017", "0018", "0019", "0020", "0021", "0022", "0023", "0024", "0025", "0026", "0027"];
const casos = [
  [0, [], /proyecto vacío: corré «npm run db:bundle -- 1 27»/],
  [3, TODAS.slice(0, 3), /faltan de la 0004 en adelante: corré «npm run db:bundle -- 4 27»/],
  [5, TODAS.slice(0, 5), /faltan de la 0006 en adelante: corré «npm run db:bundle -- 6 27»/],
  [7, TODAS.slice(0, 7), /faltan de la 0008 en adelante: corré «npm run db:bundle -- 8 27»/],
  [10, TODAS.slice(0, 10), /faltan de la 0011 en adelante: corré «npm run db:bundle -- 11 27» y pegá supabase\/aplicar-0011-a-0027\.sql/],
  [11, TODAS.slice(0, 11), /faltan de la 0012 en adelante: corré «npm run db:bundle -- 12 27» y pegá supabase\/aplicar-0012-a-0027\.sql/],
  [12, TODAS.slice(0, 12), /faltan de la 0013 en adelante: corré «npm run db:bundle -- 13 27» y pegá supabase\/aplicar-0013-a-0027\.sql/],
  [13, TODAS.slice(0, 13), /faltan de la 0014 en adelante: corré «npm run db:bundle -- 14 27» y pegá supabase\/aplicar-0014-a-0027\.sql/],
  [14, TODAS.slice(0, 14), /faltan de la 0015 en adelante: corré «npm run db:bundle -- 15 27» y pegá supabase\/aplicar-0015-a-0027\.sql/],
  [15, TODAS.slice(0, 15), /faltan de la 0016 en adelante: corré «npm run db:bundle -- 16 27» y pegá supabase\/aplicar-0016-a-0027\.sql/],
  [16, TODAS.slice(0, 16), /faltan de la 0017 en adelante: corré «npm run db:bundle -- 17 27» y pegá supabase\/aplicar-0017-a-0027\.sql/],
  [17, TODAS.slice(0, 17), /faltan de la 0018 en adelante: corré «npm run db:bundle -- 18 27» y pegá supabase\/aplicar-0018-a-0027\.sql/],
  [18, TODAS.slice(0, 18), /faltan de la 0019 en adelante: corré «npm run db:bundle -- 19 27» y pegá supabase\/aplicar-0019-a-0027\.sql/],
  [19, TODAS.slice(0, 19), /faltan de la 0020 en adelante: corré «npm run db:bundle -- 20 27» y pegá supabase\/aplicar-0020-a-0027\.sql/],
  [20, TODAS.slice(0, 20), /faltan de la 0021 en adelante: corré «npm run db:bundle -- 21 27» y pegá supabase\/aplicar-0021-a-0027\.sql/],
  [21, TODAS.slice(0, 21), /faltan de la 0022 en adelante: corré «npm run db:bundle -- 22 27» y pegá supabase\/aplicar-0022-a-0027\.sql/],
  [22, TODAS.slice(0, 22), /faltan de la 0023 en adelante: corré «npm run db:bundle -- 23 27» y pegá supabase\/aplicar-0023-a-0027\.sql/],
  [23, TODAS.slice(0, 23), /faltan de la 0024 en adelante: corré «npm run db:bundle -- 24 27» y pegá supabase\/aplicar-0024-a-0027\.sql/],
  [24, TODAS.slice(0, 24), /faltan de la 0025 en adelante: corré «npm run db:bundle -- 25 27» y pegá supabase\/aplicar-0025-a-0027\.sql/],
  [25, TODAS.slice(0, 25), /faltan de la 0026 en adelante: corré «npm run db:bundle -- 26 27» y pegá supabase\/aplicar-0026-a-0027\.sql/],
  [26, TODAS.slice(0, 26), /faltan de la 0027 en adelante: corré «npm run db:bundle -- 27 27» y pegá supabase\/aplicar-0027-a-0027\.sql/],
  [999, TODAS, /nada: están todas/],
];
for (const [upTo, esperadas, consejo] of casos) {
  const db = await makeDb({ upTo });
  let filas;
  try {
    filas = await correr(db, DIAGNOSTICO);
  } catch (e) {
    r.push([false, `diagnóstico con migraciones hasta ${upTo}: falló (${e.message.slice(0, 80)})`]);
    continue;
  }
  const aplicadas = filas.filter((f) => f.aplicada === "sí" && /^\d{4}/.test(f.migracion)).map((f) => f.migracion.slice(0, 4));
  const ultima = filas[filas.length - 1].migracion;
  r.push([
    JSON.stringify(aplicadas) === JSON.stringify(esperadas) && consejo.test(ultima),
    `diagnóstico con migraciones hasta ${upTo === 999 ? "la última" : upTo}: ${aplicadas.join(", ") || "ninguna"} → «${ultima.slice(0, 70)}»`,
  ]);
}

// --- Verificación con todas las migraciones ----------------------------------------------------------------
{
  const db = await makeDb();
  await seed(db);
  const filas = await correr(db, VERIFICACION);
  const por = Object.fromEntries(filas.map((f) => [f.orden, f]));
  const migracionesOk = filas.filter((f) => f.orden <= 19 || f.orden >= 23).every((f) => f.resultado === "OK");
  r.push([migracionesOk && filas.length === 34, `verificación completa: las 31 comprobaciones de migraciones (1 a 19 y 23 a 34) dan OK (${filas.length} filas)`]);
  // El seed de las pruebas tiene una reserva «confirmada» sin pago: la verificación tiene que verla.
  r.push([por[20].resultado === "REVISAR", `detecta reservas confirmadas sin pago: ${por[20].comprobacion} → ${por[20].resultado}`]);
  r.push([por[21].resultado === "OK", `ve la cuenta de administración: ${por[21].comprobacion}`]);
  r.push([por[22].resultado === "OK", `sin cuentas del seed viejo: ${por[22].comprobacion}`]);

  // Con el pago registrado, y una cuenta de demo vieja.
  await db.exec(`
    insert into public.payments (booking_id, status, amount) select id, 'aprobado', 1 from public.bookings where status in ('confirmada', 'completada');
    insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000ee', 'maria.gonzalez.demo@estudiapp.test');
  `);
  const filas2 = Object.fromEntries((await correr(db, VERIFICACION)).map((f) => [f.orden, f]));
  r.push([filas2[20].resultado === "OK", "con el pago registrado, la comprobación de reservas da OK"]);
  r.push([filas2[22].resultado === "REVISAR", `detecta cuentas del seed viejo: ${filas2[22].comprobacion}`]);

  // Un auth.users sin columna email (no es el caso de Supabase): la comprobación no se rompe.
  await db.exec(`alter table auth.users drop column email`);
  const filas3 = Object.fromEntries((await correr(db, VERIFICACION)).map((f) => [f.orden, f]));
  r.push([filas3[22].resultado === "NO SE PUDO COMPROBAR", "sin columna email en auth.users no se rompe (no se pudo comprobar)"]);
}

// --- Verificación sin la 0010: tiene que avisar, no romperse ------------------------------------------------
{
  const db = await makeDb({ upTo: 9 });
  let filas;
  try {
    filas = await correr(db, VERIFICACION);
  } catch (e) {
    r.push([false, `verificación sin la 0010: se rompió (${e.message.slice(0, 80)})`]);
  }
  if (filas) {
    const fallas = filas.filter((f) => f.resultado === "FALLA").map((f) => f.orden);
    r.push([
      JSON.stringify(fallas) === JSON.stringify([2, 3, 4, 9, 12, 13, 14, 15, 16, 17, 18, 19, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34]),
      `sin la 0010 ni las siguientes marca FALLA en datos privados, guardas y cobro (filas ${fallas.join(", ")})`,
    ]);
  }
}

// --- Verificación con las migraciones hasta una dada: solo faltan las comprobaciones de las que no están ---------
//   hasta 0010 → faltan 0011 a 0015; hasta 0011 → 0012 a 0015; hasta 0012 → 0013 a 0015; hasta 0013 → 0014 y 0015;
//   hasta 0014 → de la 0015 en adelante; hasta 0015 → la 0016 (fila 23), la 0017 (fila 24) y la 0018 (fila 25); hasta 0016 → 0017 y 0018;
//   hasta 0017 → 0018 y 0019; hasta 0018 → 0019 y 0020; hasta 0019 → 0020 y 0021; hasta 0020 → 0021 a 0023; hasta 0021 → 0022 a 0024; hasta 0022 → 0023 y 0024; hasta 0023 → 0024 y 0025; hasta 0024 → 0025 a 0027; hasta 0025 → 0026 y 0027; hasta 0026 → solo la 0027 (fila 34).
for (const [upTo, esperadas] of [
  [10, [12, 13, 14, 15, 16, 17, 18, 19, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34]],
  [11, [16, 17, 18, 19, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34]],
  [12, [17, 18, 19, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34]],
  [13, [18, 19, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34]],
  [14, [19, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34]],
  [15, [23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34]],
  [16, [24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34]],
  [17, [25, 26, 27, 28, 29, 30, 31, 32, 33, 34]],
  [18, [26, 27, 28, 29, 30, 31, 32, 33, 34]],
  [19, [27, 28, 29, 30, 31, 32, 33, 34]],
  [20, [28, 29, 30, 31, 32, 33, 34]],
  [21, [29, 30, 31, 32, 33, 34]],
  [22, [30, 31, 32, 33, 34]],
  [23, [31, 32, 33, 34]],
  [24, [32, 33, 34]],
  [25, [33, 34]],
  [26, [34]],
]) {
  const db = await makeDb({ upTo });
  const filas = await correr(db, VERIFICACION);
  const fallas = filas.filter((f) => f.resultado === "FALLA").map((f) => f.orden);
  r.push([
    JSON.stringify(fallas) === JSON.stringify(esperadas),
    `con 0001 a ${String(upTo).padStart(4, "0")} solo marca FALLA lo que falta del cobro, los emails y las calificaciones (filas ${fallas.join(", ")})`,
  ]);
}

// --- Una función con permisos de más tiene que marcar FALLA ---------------------------------------------------------
// (la verificación no solo mira que las funciones existan: mira quién las puede ejecutar)
const sabotajes = await makeDb();
for (const [fila, descripcion, sabotaje] of [
  [16, "enqueue_refund queda abierta a un usuario con sesión", "grant execute on function public.enqueue_refund(text, uuid, uuid, integer, numeric, text, text) to authenticated"],
  [17, "retryable_refunds queda abierta a un visitante", "grant execute on function public.retryable_refunds(integer) to anon"],
  [17, "cancel_booking queda cerrada a los usuarios con sesión", "revoke execute on function public.cancel_booking(uuid, text) from authenticated"],
  [18, "save_mp_credentials queda abierta a un usuario con sesión", "grant execute on function public.save_mp_credentials(uuid, text, text, text, text, timestamptz, boolean) to authenticated"],
  [18, "rotate_mp_tokens queda abierta a un visitante", "grant execute on function public.rotate_mp_tokens(uuid, text, text, timestamptz) to anon"],
  [18, "unlink_my_mp_account queda abierta a un visitante", "grant execute on function public.unlink_my_mp_account() to anon"],
  [19, "la bandeja de emails queda legible por un usuario con sesión", "grant select on public.email_outbox to authenticated"],
  [19, "claim_pending_emails queda abierta a un usuario con sesión", "grant execute on function public.claim_pending_emails(integer) to authenticated"],
  [19, "mark_email_result queda abierta a un visitante", "grant execute on function public.mark_email_result(uuid, text, text) to anon"],
  [19, "falta el trigger que anota los reembolsos aprobados", "drop trigger refunds_enqueue_approved_email on public.refunds"],
  [23, "la tabla de calificaciones vuelve a ser pública", "create policy ratings_select_public_when_tutor_approved on public.ratings for select using (true)"],
  [23, "falta el trigger que pone la fecha de la calificación", "drop trigger ratings_normalize on public.ratings"],
  [24, "record_class_attendance queda abierta a un usuario con sesión", "grant execute on function public.record_class_attendance(uuid, integer, integer) to authenticated"],
  [24, "sync_bookings vuelve a completar las clases apenas terminan", "create or replace function public.sync_bookings() returns integer language sql as $f$ select 0 $f$"],
  [25, "enqueue_class_reminders queda abierta a un usuario con sesión", "grant execute on function public.enqueue_class_reminders() to authenticated"],
  [25, "falta el trigger del email de la decisión sobre el perfil", "drop trigger tutor_profiles_enqueue_decision_email on public.tutor_profiles"],
  [26, "el registro de acciones queda legible por un visitante", "grant select on public.audit_log to anon"],
  [26, "el registro de acciones se puede editar", "drop trigger audit_log_immutable on public.audit_log"],
  [26, "las cancelaciones de la administración dejan de registrarse", "drop trigger bookings_audit_admin_cancel on public.bookings"],
  [27, "admin_metrics queda abierta a un visitante", "grant execute on function public.admin_metrics(integer) to anon"],
  [28, "los escalones de comisión quedan legibles por un visitante", "grant select on public.commission_tiers to anon"],
  [28, "los cambios de escalones dejan de registrarse", "drop trigger commission_tiers_audit on public.commission_tiers"],
  [29, "un visitante puede cambiar el contenido", "grant update on public.site_content to anon"],
  [30, "el resumen de la bandeja queda abierto a un visitante", "grant execute on function public.email_outbox_summary() to anon"],
  [31, "cualquiera con sesión registra intentos de pago", "grant execute on function public.register_card_attempt(uuid) to authenticated"],
  [31, "se quita el tope de reservas por día", "drop trigger bookings_limit_daily_holds on public.bookings"],
  [32, "la búsqueda pasa a correr con los permisos de quien la creó", "alter function public.search_tutor_catalog(text, text[], numeric, numeric, boolean, text, integer, integer) security definer"],
  [33, "los respaldos quedan públicos", "update storage.buckets set public = true where id = 'credentials'"],
  [33, "se borra la política que limita las fotos a la propia subcarpeta", "drop policy \"estudiapp_avatars_insert_own\" on storage.objects"],
  [33, "cualquiera puede leer los respaldos", "create policy \"x\" on storage.objects for select to anon using (bucket_id = 'credentials')"],
  [34, "cualquiera con sesión escribe apelaciones", "grant insert on public.rating_appeals to authenticated"],
  [34, "un visitante puede apelar", "grant execute on function public.appeal_rating(uuid, text) to anon"],
  [34, "una reseña quitada se puede volver a escribir", "drop trigger ratings_block_removed on public.ratings"],
  [34, "el nivel de cualquier docente queda abierto", "grant execute on function public.commission_level_of(uuid) to authenticated"],
  [32, "un visitante ya no puede buscar", "revoke execute on function public.search_tutor_catalog(text, text[], numeric, numeric, boolean, text, integer, integer) from anon"],
]) {
  // Cada sabotaje corre en una transacción que se deshace, así que se reutiliza la misma base.
  await sabotajes.exec("begin");
  try {
    await sabotajes.exec(sabotaje);
    const f = (await correr(sabotajes, VERIFICACION)).find((x) => x.orden === fila);
    r.push([f.resultado === "FALLA", `la fila ${fila} marca FALLA si ${descripcion}`]);
  } finally {
    await sabotajes.exec("rollback");
  }
}

// --- Diagnóstico con un hueco: 0008 aplicada pero no la 0007 ---------------------------------------------------
{
  const db = await makeDb({ upTo: 6 });
  await applyMigration(db, 8);
  const filas = await correr(db, DIAGNOSTICO);
  r.push([/estado mezclado/.test(filas.at(-1).migracion), "con un hueco (0008 sin 0007) dice «estado mezclado» y no recomienda el archivo único"]);
}

// --- Verificación en un proyecto vacío: tampoco se rompe ------------------------------------------------------
{
  const db = await makeDb({ upTo: 0 });
  try {
    const filas = await correr(db, VERIFICACION);
    r.push([filas.some((f) => f.resultado === "FALLA"), "en un proyecto vacío la verificación avisa FALLA sin romperse"]);
  } catch (e) {
    r.push([false, `verificación en un proyecto vacío: se rompió (${e.message.slice(0, 80)})`]);
  }
}

report(r);
