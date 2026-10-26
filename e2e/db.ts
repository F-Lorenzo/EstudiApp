import { execFileSync } from "node:child_process";

/**
 * Consultas directas a la base LOCAL de las pruebas, como haría alguien desde el SQL Editor. Se usan solo para lo
 * que no se puede hacer desde la app: dar el rol de administración, vincular una cuenta de Mercado Pago de mentira
 * y adelantar el reloj de una clase.
 */
const status = JSON.parse(
  execFileSync("npx", ["supabase", "status", "-o", "json", "--workdir", "e2e"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }),
) as { DB_URL: string };

if (!/^postgresql:\/\/[^@]+@(127\.0\.0\.1|localhost):/.test(status.DB_URL)) throw new Error("La base de las pruebas no es local.");

/** Corre SQL y devuelve las filas como texto (una por línea, columnas separadas por «|»). */
export function sql(query: string): string[] {
  const out = execFileSync("psql", [status.DB_URL, "-v", "ON_ERROR_STOP=1", "-At", "-c", query], { encoding: "utf8" });
  return out.split("\n").filter(Boolean);
}

/** Un solo valor. */
export function value(query: string): string {
  const [row] = sql(query);
  if (row === undefined) throw new Error(`Sin resultado: ${query}`);
  return row;
}
