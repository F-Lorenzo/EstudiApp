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
const TODAS = ["0001", "0002", "0003", "0004", "0005", "0006", "0007", "0008", "0009", "0010", "0011"];
const casos = [
  [0, [], /proyecto vacío: corré «npm run db:bundle -- 1 11»/],
  [3, TODAS.slice(0, 3), /faltan de la 0004 en adelante: corré «npm run db:bundle -- 4 11»/],
  [5, TODAS.slice(0, 5), /faltan de la 0006 en adelante: corré «npm run db:bundle -- 6 11»/],
  [7, TODAS.slice(0, 7), /faltan de la 0008 en adelante: corré «npm run db:bundle -- 8 11»/],
  [10, TODAS.slice(0, 10), /faltan de la 0011 en adelante: corré «npm run db:bundle -- 11 11» y pegá supabase\/aplicar-0011-a-0011\.sql/],
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
  const migracionesOk = filas.filter((f) => f.orden <= 15).every((f) => f.resultado === "OK");
  r.push([migracionesOk && filas.length === 18, `verificación completa: las 15 comprobaciones de migraciones dan OK (${filas.length} filas)`]);
  // El seed de las pruebas tiene una reserva «confirmada» sin pago: la verificación tiene que verla.
  r.push([por[16].resultado === "REVISAR", `detecta reservas confirmadas sin pago: ${por[16].comprobacion} → ${por[16].resultado}`]);
  r.push([por[17].resultado === "OK", `ve la cuenta de administración: ${por[17].comprobacion}`]);
  r.push([por[18].resultado === "NO SE PUDO COMPROBAR", "sin columna email en auth.users no se rompe (no se pudo comprobar)"]);

  // Con el pago y con auth.users como en Supabase (con email), y una cuenta de demo vieja.
  await db.exec(`
    insert into public.payments (booking_id, status, amount) select id, 'aprobado', 1 from public.bookings where status in ('confirmada', 'completada');
    alter table auth.users add column email text;
    insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000ee', 'maria.gonzalez.demo@estudiapp.test');
  `);
  const filas2 = Object.fromEntries((await correr(db, VERIFICACION)).map((f) => [f.orden, f]));
  r.push([filas2[16].resultado === "OK", "con el pago registrado, la comprobación de reservas da OK"]);
  r.push([filas2[18].resultado === "REVISAR", `detecta cuentas del seed viejo: ${filas2[18].comprobacion}`]);
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
      JSON.stringify(fallas) === JSON.stringify([2, 3, 4, 9, 12, 13, 14, 15]),
      `sin la 0010 ni la 0011 marca FALLA en datos privados, guardas y cobro (filas ${fallas.join(", ")})`,
    ]);
  }
}

// --- Verificación con 0001 a 0010 (falta solo la 0011) -------------------------------------------------------
{
  const db = await makeDb({ upTo: 10 });
  const filas = await correr(db, VERIFICACION);
  const fallas = filas.filter((f) => f.resultado === "FALLA").map((f) => f.orden);
  r.push([JSON.stringify(fallas) === JSON.stringify([12, 13, 14, 15]), `con 0001 a 0010 solo marca FALLA el cobro (filas ${fallas.join(", ")})`]);
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
