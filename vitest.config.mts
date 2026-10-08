import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Pruebas unitarias de la lógica pura (`src/**/*.test.ts`). Las pruebas de la base de datos son
// aparte: `npm run test:db` (supabase/tests).
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
