// Corre todas las pruebas de la base de datos (`*.db.mjs`), una por proceso, y falla si alguna falla.
//   npm run test:db            todas
//   npm run test:db -- bookings   solo las que contengan «bookings» en el nombre
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL(".", import.meta.url));
const filter = process.argv[2];
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".db.mjs") && (!filter || f.includes(filter)))
  .sort();

if (files.length === 0) {
  console.error("No hay pruebas que coincidan.");
  process.exit(1);
}

let failed = 0;
for (const file of files) {
  console.log(`\n=== ${file} ===`);
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(file, import.meta.url))], {
    stdio: "inherit",
  });
  if (result.status !== 0) failed++;
}

console.log(failed ? `\n${failed} de ${files.length} archivos con fallas` : `\nLas ${files.length} suites pasaron`);
process.exit(failed ? 1 : 0);
