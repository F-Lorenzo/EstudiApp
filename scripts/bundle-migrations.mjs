// Junta varias migraciones en UN solo archivo para pegarlo de una vez en el SQL Editor de Supabase.
//
//   npm run db:bundle              migraciones 6 a la última  -> supabase/aplicar-0006-a-0010.sql
//   npm run db:bundle -- 8 10      migraciones 8 a 10
//
// El archivo se genera a partir de supabase/migrations (no se edita a mano ni se guarda en git). Va
// envuelto en una transacción: si algo falla, no queda nada a medias.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dir = path.join(root, "supabase", "migrations");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const numberOf = (file) => Number(file.slice(0, 4));

const from = Number(process.argv[2] ?? 6);
const to = Number(process.argv[3] ?? numberOf(files[files.length - 1]));
const selected = files.filter((f) => numberOf(f) >= from && numberOf(f) <= to);

if (selected.length === 0 || Number.isNaN(from) || Number.isNaN(to)) {
  console.error(`No hay migraciones entre ${from} y ${to}.`);
  process.exit(1);
}

const pad = (n) => String(n).padStart(4, "0");
const out = path.join(root, "supabase", `aplicar-${pad(from)}-a-${pad(to)}.sql`);

const header = `-- EstudiApp — migraciones ${pad(from)} a ${pad(to)} en un solo archivo.
-- GENERADO por scripts/bundle-migrations.mjs. No lo edites: cambiá las migraciones y volvé a generarlo.
--
-- Cómo usarlo: SQL Editor de Supabase → pegar todo → Run. Corre en UNA transacción: si algo falla,
-- no queda nada a medias y podés corregir y volver a pegarlo.
--
-- ANTES de correrlo, en un proyecto con datos, corré estas consultas en el SQL Editor:
--
--   1) Franjas duplicadas (la 0007 se corta si hay alguna):
--        select tutor_id, starts_at, count(*) from public.availability_slots
--        group by tutor_id, starts_at having count(*) > 1;
--
--   2) Reservas «confirmada» o «completada» SIN pago aprobado. Antes de la 0008 un alumno podía
--      confirmarse una reserva sin pagar; si aparecen filas, revisalas a mano:
--        select b.id, b.student_id, b.tutor_id, b.status from public.bookings b
--        where b.status in ('confirmada', 'completada')
--          and not exists (select 1 from public.payments p
--                          where p.booking_id = b.id and p.status = 'aprobado');
--
-- Migraciones incluidas: ${selected.join(", ")}

begin;
`;

const body = selected
  .map((file) => `\n-- ===== ${file} =====\n\n${fs.readFileSync(path.join(dir, file), "utf8").trim()}\n`)
  .join("");

fs.writeFileSync(out, `${header}${body}\ncommit;\n`);
console.log(`Listo: ${path.relative(root, out)} (${selected.length} migraciones: ${selected.map((f) => f.slice(0, 4)).join(", ")})`);
