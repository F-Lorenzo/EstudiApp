// Junta varias migraciones en UN solo archivo para pegarlo de una vez en el SQL Editor de Supabase.
//
//   npm run db:bundle                       migraciones 6 a la última -> supabase/aplicar-0006-a-0010.sql
//   npm run db:bundle -- 8 10               migraciones 8 a 10
//   npm run db:bundle -- 1 10               INSTALACIÓN DESDE CERO    -> supabase/aplicar-0001-a-0010.sql
//   npm run db:bundle -- 1 10 --compacto    igual, sin los comentarios (más corto para copiar y pegar)
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

const args = process.argv.slice(2);
const compact = args.includes("--compacto");
const numbers = args.filter((a) => !a.startsWith("--"));

const from = Number(numbers[0] ?? 6);
const to = Number(numbers[1] ?? numberOf(files[files.length - 1]));
const selected = files.filter((f) => numberOf(f) >= from && numberOf(f) <= to);

if (selected.length === 0 || Number.isNaN(from) || Number.isNaN(to)) {
  console.error(`No hay migraciones entre ${from} y ${to}.`);
  process.exit(1);
}

const pad = (n) => String(n).padStart(4, "0");
const out = path.join(
  root,
  "supabase",
  `aplicar-${pad(from)}-a-${pad(to)}${compact ? "-compacto" : ""}.sql`,
);
const fromScratch = from === 1;

const header = `-- EstudiApp — migraciones ${pad(from)} a ${pad(to)} en un solo archivo${fromScratch ? " (instalación desde cero)" : ""}.
-- GENERADO por scripts/bundle-migrations.mjs. No lo edites: cambiá las migraciones y volvé a generarlo.
--
-- Cómo usarlo: SQL Editor de Supabase → pegar todo → Run. Corre en UNA transacción: si algo falla,
-- no queda nada a medias y podés corregir y volver a pegarlo.
${
  fromScratch
    ? `--
-- Es para un proyecto NUEVO y vacío. Si el proyecto ya tiene tablas de EstudiApp, no lo uses:
-- corré supabase/checks/1-diagnostico.sql y seguí lo que diga.
`
    : `--
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
`
}-- Migraciones incluidas: ${selected.join(", ")}

begin;
`;

/**
 * Saca las líneas que son solo un comentario (`-- ...`). No toca los comentarios dentro de una línea
 * de código ni el interior de los textos: ninguna línea de las migraciones empieza con `--` dentro de
 * un texto entre comillas, y la prueba `fresh-install.db.mjs` comprueba que el resultado es idéntico.
 */
function stripComments(sql) {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const body = selected
  .map((file) => {
    const sql = fs.readFileSync(path.join(dir, file), "utf8").replace(/\r\n/g, "\n").trim();
    return `\n-- ===== ${file} =====\n\n${compact ? stripComments(sql) : sql}\n`;
  })
  .join("");

fs.writeFileSync(out, `${header}${body}\ncommit;\n`);
console.log(
  `Listo: ${path.relative(root, out)} (${selected.length} migraciones: ${selected.map((f) => f.slice(0, 4)).join(", ")}${compact ? ", sin comentarios" : ""})`,
);
