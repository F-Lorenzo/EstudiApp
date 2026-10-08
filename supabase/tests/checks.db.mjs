// Las consultas de supabase/checks se pegan en el SQL Editor de un proyecto real, en cualquier
// estado. Esta prueba las corre en cada estado posible (vacío, 0001-0005, mezclado, completo) y
// comprueba que no fallen y que digan lo correcto.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { makeDb, report } from "./harness.mjs";
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
const casos = [
  [0, [], /proyecto vacío/],
  [3, ["0001", "0002", "0003"], /faltan algunas de 0001 a 0005/],
  [5, ["0001", "0002", "0003", "0004", "0005"], /aplicá supabase\/aplicar-0006-a-0010\.sql/],
  [7, ["0001", "0002", "0003", "0004", "0005", "0006", "0007"], /estado mezclado/],
  [999, ["0001", "0002", "0003", "0004", "0005", "0006", "0007", "0008", "0009", "0010"], /nada: están todas/],
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
  const migracionesOk = filas.filter((f) => f.orden <= 11).every((f) => f.resultado === "OK");
  r.push([migracionesOk && filas.length === 14, `verificación completa: las 11 comprobaciones de migraciones dan OK (${filas.length} filas)`]);
  // El seed de las pruebas tiene una reserva «confirmada» sin pago: la verificación tiene que verla.
  r.push([por[12].resultado === "REVISAR", `detecta reservas confirmadas sin pago: ${por[12].comprobacion} → ${por[12].resultado}`]);
  r.push([por[13].resultado === "OK", `ve la cuenta de administración: ${por[13].comprobacion}`]);
  r.push([por[14].resultado === "NO SE PUDO COMPROBAR", "sin columna email en auth.users no se rompe (no se pudo comprobar)"]);

  // Con el pago y con auth.users como en Supabase (con email), y una cuenta de demo vieja.
  await db.exec(`
    insert into public.payments (booking_id, status, amount) select id, 'aprobado', 1 from public.bookings where status in ('confirmada', 'completada');
    alter table auth.users add column email text;
    insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000ee', 'maria.gonzalez.demo@estudiapp.test');
  `);
  const filas2 = Object.fromEntries((await correr(db, VERIFICACION)).map((f) => [f.orden, f]));
  r.push([filas2[12].resultado === "OK", "con el pago registrado, la comprobación de reservas da OK"]);
  r.push([filas2[14].resultado === "REVISAR", `detecta cuentas del seed viejo: ${filas2[14].comprobacion}`]);
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
      JSON.stringify(fallas) === JSON.stringify([2, 3, 4, 9]),
      `sin la 0010 marca FALLA en datos privados y guardas (filas ${fallas.join(", ")})`,
    ]);
  }
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
