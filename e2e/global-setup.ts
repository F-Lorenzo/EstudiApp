import { execFileSync } from "node:child_process";
import path from "node:path";

/** Antes de correr: la base local vacía y con todas las migraciones (scripts/e2e-db.mjs). */
export default function globalSetup() {
  execFileSync("node", ["scripts/e2e-db.mjs"], { cwd: path.join(__dirname, ".."), stdio: "inherit" });
}
