// Arnés de las pruebas de base de datos: un Postgres real (PGlite, en memoria) con lo mínimo de
// Supabase (esquema auth, roles anon / authenticated / service_role) sobre el que se aplican las
// migraciones de verdad. Cada prueba ejecuta consultas "como" un rol de la API, así que la RLS y
// los permisos se comprueban de punta a punta.
import { PGlite } from "@electric-sql/pglite";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ESTUDIAPP_MIGRATIONS_DIR apunta a otra carpeta de migraciones: así se prueban las MUTACIONES (una regla rota a
// propósito en una copia) sin tocar los archivos reales. Ver «Mutaciones» en supabase/tests/README.md.
const MIGRATIONS = process.env.ESTUDIAPP_MIGRATIONS_DIR ?? fileURLToPath(new URL("../migrations", import.meta.url));

export const ids = {
  alumno: "00000000-0000-0000-0000-0000000000a1",
  alumno2: "00000000-0000-0000-0000-0000000000a2",
  docente: "00000000-0000-0000-0000-0000000000d1",
  docente2: "00000000-0000-0000-0000-0000000000d2",
  admin: "00000000-0000-0000-0000-0000000000ad",
};

function migrationFiles() {
  return fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
}

function readMigration(file) {
  // El arnés usa gen_random_uuid() nativo: no hace falta pgcrypto.
  return fs
    .readFileSync(path.join(MIGRATIONS, file), "utf8")
    .replace(/create extension if not exists "pgcrypto";/i, "-- pgcrypto omitido en el arnés");
}

/** Aplica la migración con ese número (por ejemplo 10) a una base ya creada. */
export async function applyMigration(db, number) {
  const file = migrationFiles().find((f) => Number(f.slice(0, 4)) === number);
  if (!file) throw new Error(`No existe la migración ${number}`);
  try {
    await db.exec(readMigration(file));
  } catch (e) {
    throw new Error(`Migración ${file} falló: ${e.message}`);
  }
}

/** Crea una base nueva con las migraciones hasta `upTo` (inclusive). */
export async function makeDb({ upTo = 999 } = {}) {
  // unaccent (0025) es una extensión de Postgres: PGlite la trae aparte. Supabase la instala en `extensions`.
  const db = new PGlite({ extensions: { unaccent } });
  await db.exec(`
    create schema auth;
    create schema extensions;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}');
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth, extensions to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  `);
  for (const file of migrationFiles()) {
    if (Number(file.slice(0, 4)) > upTo) continue;
    try {
      await db.exec(readMigration(file));
    } catch (e) {
      throw new Error(`Migración ${file} falló: ${e.message}`);
    }
  }
  return db;
}

/** Ejecuta `fn` como un rol de la API: "anon", "service" o un usuario autenticado (clave de `ids` o uuid). */
export async function as(db, who, fn) {
  const role = who === "anon" ? "anon" : who === "service" ? "service_role" : "authenticated";
  const sub = who === "anon" || who === "service" ? "" : (ids[who] ?? who);
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${sub}', false); set role ${role};`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role;");
  }
}

export async function expectFail(label, promise, results) {
  try {
    await promise;
    results.push([false, `${label} (debía fallar y NO falló)`]);
  } catch (e) {
    results.push([true, `${label}  → ${String(e.message).split("\n")[0].slice(0, 90)}`]);
  }
}

export async function expectOk(label, promise, results) {
  try {
    await promise;
    results.push([true, label]);
  } catch (e) {
    results.push([false, `${label}  → ${String(e.message).split("\n")[0].slice(0, 120)}`]);
  }
}

/**
 * Registra la lista de resultados de una suite: si la prueba se corta con una excepción (por ejemplo, porque una regla
 * rota dejó datos que el resto de la prueba daba por hechos), se imprime lo que se alcanzó a comprobar más el motivo,
 * en vez de perder todo el informe. Uso: `const r = track([]);`
 */
export function track(results) {
  process.on("uncaughtException", (e) => {
    results.push([false, `la suite se interrumpió: ${e?.hint ? `(hint=${e.hint}) ` : ""}${String(e?.message ?? e).split("\n")[0].slice(0, 200)}`]);
    report(results);
    process.exit(1);
  });
  return results;
}

export function report(results) {
  let bad = 0;
  for (const [ok, msg] of results) {
    console.log(ok ? "ok   " : "FAIL ", msg);
    if (!ok) bad++;
  }
  console.log(bad ? `\n${bad} FALLARON de ${results.length}` : `\nTodas pasaron (${results.length})`);
  process.exitCode = bad ? 1 : 0;
}
