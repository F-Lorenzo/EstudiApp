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
const TODAS = ["0001", "0002", "0003", "0004", "0005", "0006", "0007", "0008", "0009", "0010", "0011", "0012", "0013", "0014", "0015", "0016"];
const casos = [
  [0, [], /proyecto vacío: corré «npm run db:bundle -- 1 16»/],
  [3, TODAS.slice(0, 3), /faltan de la 0004 en adelante: corré «npm run db:bundle -- 4 16»/],
  [5, TODAS.slice(0, 5), /faltan de la 0006 en adelante: corré «npm run db:bundle -- 6 16»/],
  [7, TODAS.slice(0, 7), /faltan de la 0008 en adelante: corré «npm run db:bundle -- 8 16»/],
  [10, TODAS.slice(0, 10), /faltan de la 0011 en adelante: corré «npm run db:bundle -- 11 16» y pegá supabase\/aplicar-0011-a-0016\.sql/],
  [11, TODAS.slice(0, 11), /faltan de la 0012 en adelante: corré «npm run db:bundle -- 12 16» y pegá supabase\/aplicar-0012-a-0016\.sql/],
  [12, TODAS.slice(0, 12), /faltan de la 0013 en adelante: corré «npm run db:bundle -- 13 16» y pegá supabase\/aplicar-0013-a-0016\.sql/],
  [13, TODAS.slice(0, 13), /faltan de la 0014 en adelante: corré «npm run db:bundle -- 14 16» y pegá supabase\/aplicar-0014-a-0016\.sql/],
  [14, TODAS.slice(0, 14), /faltan de la 0015 en adelante: corré «npm run db:bundle -- 15 16» y pegá supabase\/aplicar-0015-a-0016\.sql/],
  [15, TODAS.slice(0, 15), /faltan de la 0016 en adelante: corré «npm run db:bundle -- 16 16» y pegá supabase\/aplicar-0016-a-0016\.sql/],
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
  const migracionesOk = filas.filter((f) => f.orden <= 19 || f.orden === 23).every((f) => f.resultado === "OK");
  r.push([migracionesOk && filas.length === 23, `verificación completa: las 20 comprobaciones de migraciones (1 a 19 y 23) dan OK (${filas.length} filas)`]);
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
      JSON.stringify(fallas) === JSON.stringify([2, 3, 4, 9, 12, 13, 14, 15, 16, 17, 18, 19, 23]),
      `sin la 0010 ni las siguientes marca FALLA en datos privados, guardas y cobro (filas ${fallas.join(", ")})`,
    ]);
  }
}

// --- Verificación con las migraciones hasta una dada: solo faltan las comprobaciones de las que no están ---------
//   hasta 0010 → faltan 0011 a 0015; hasta 0011 → 0012 a 0015; hasta 0012 → 0013 a 0015; hasta 0013 → 0014 y 0015;
//   hasta 0014 → la 0015 y la 0016; hasta 0015 → solo la 0016 (fila 23).
for (const [upTo, esperadas] of [
  [10, [12, 13, 14, 15, 16, 17, 18, 19, 23]],
  [11, [16, 17, 18, 19, 23]],
  [12, [17, 18, 19, 23]],
  [13, [18, 19, 23]],
  [14, [19, 23]],
  [15, [23]],
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
