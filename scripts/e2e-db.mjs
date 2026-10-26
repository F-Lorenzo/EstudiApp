// Prepara la base de las pruebas de punta a punta (e2e/README.md): vacía la base del Supabase LOCAL de
// e2e/supabase y le aplica todas las migraciones con el mismo archivo único que se usa para un proyecto nuevo.
//
//   node scripts/e2e-db.mjs            reinicia la base y aplica las migraciones
//
// Solo toca el Supabase local (127.0.0.1): se niega a correr contra cualquier otra dirección.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const supabase = (...args) =>
  execFileSync("npx", ["supabase", ...args, "--workdir", "e2e"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

function localStatus() {
  const status = JSON.parse(supabase("status", "-o", "json"));
  for (const key of ["DB_URL", "API_URL"]) {
    const host = new URL(status[key]).hostname;
    if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`${key} no es local (${host}): no se toca.`);
  }
  return status;
}

function resetDatabase() {
  const status = localStatus();
  supabase("db", "reset", "--no-seed");
  const last = fs.readdirSync(path.join(ROOT, "supabase", "migrations")).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort().at(-1).slice(0, 4);
  execFileSync("node", ["scripts/bundle-migrations.mjs", "1", String(Number(last))], { cwd: ROOT, stdio: "ignore" });
  execFileSync("psql", [status.DB_URL, "-v", "ON_ERROR_STOP=1", "-q", "-f", `supabase/aplicar-0001-a-${last}.sql`], {
    cwd: ROOT,
    stdio: ["ignore", "ignore", "pipe"],
  });
  return status;
}

const status = resetDatabase();
console.log(`Base de pruebas lista en ${status.DB_URL}`);
