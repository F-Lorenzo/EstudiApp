import { defineConfig, devices } from "@playwright/test";
import { execFileSync } from "node:child_process";

/**
 * Pruebas de punta a punta (e2e/README.md): la app real (`next dev`, para poder usar el pago simulado) contra el
 * Supabase LOCAL de e2e/supabase, con la base, la autenticación y la API reales.
 *
 *   npm run e2e        prepara la base (scripts/e2e-db.mjs) y corre todo
 *
 * Las direcciones y las claves salen de `supabase status`: son las de demo del Supabase local, no secretos.
 */
const status = JSON.parse(
  execFileSync("npx", ["supabase", "status", "-o", "json", "--workdir", "e2e"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }),
) as Record<string, string>;

const PORT = 3100;
export const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: ".",
  // El recorrido es uno solo y en orden: cada paso usa lo que dejó el anterior.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "../playwright-report" }]] : "list",
  outputDir: "../test-results",
  globalSetup: "./global-setup.ts",
  use: {
    baseURL: BASE_URL,
    locale: "es-AR",
    timezoneId: "America/Argentina/Buenos_Aires",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // En la nube de Claude Code el Chromium ya instalado está en otra ruta; en el CI lo instala Playwright.
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    cwd: "..",
    url: `${BASE_URL}/login`,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
      NEXT_PUBLIC_SITE_URL: BASE_URL,
      ALLOW_SIMULATED_PAYMENTS: "true",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
