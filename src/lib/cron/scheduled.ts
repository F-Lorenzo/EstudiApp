/**
 * El cron de Cloudflare (`triggers.crons` en wrangler.jsonc) dispara el handler `scheduled` del Worker
 * (`cloudflare-worker.ts`). Acá no se repite la lógica: se le pide la ruta de mantenimiento al mismo Worker, por
 * dentro (sin salir a la red), con el secreto del cron. Así corre exactamente lo que corre la ruta, con su
 * autorización, sus barridos y su informe.
 *
 * Sin imports de la app a propósito: este archivo lo empaqueta Wrangler junto al Worker de OpenNext.
 */
export const MAINTENANCE_PATH = "/api/cron/payments-maintenance";
const DEFAULT_SITE_URL = "https://estudiapp.app";

type Env = Record<string, unknown>;
type FetchHandler<E> = (request: Request, env: E, ctx: unknown) => Promise<Response>;

export async function runScheduledMaintenance<E extends Env>(
  fetchHandler: FetchHandler<E>,
  env: E,
  ctx: unknown,
  log: (message: string, data?: Record<string, unknown>) => void = (message, data) =>
    console.log(JSON.stringify({ source: "cron", message, ...data })),
): Promise<void> {
  const secret = text(env.CRON_SECRET) ?? text(env.MERCADOPAGO_CRON_SECRET);
  if (!secret) {
    // Sin secreto la ruta no corre nada (falla cerrada): se avisa en el log en vez de llamarla en vano.
    log("falta CRON_SECRET: no se corre el mantenimiento");
    throw new Error("Falta CRON_SECRET.");
  }

  const url = new URL(MAINTENANCE_PATH, text(env.NEXT_PUBLIC_SITE_URL) ?? DEFAULT_SITE_URL);
  const response = await fetchHandler(
    new Request(url, { method: "GET", headers: { authorization: `Bearer ${secret}` } }),
    env,
    ctx,
  );
  const body = await response.text().catch(() => "");
  // El informe de la ruta no lleva datos personales ni tokens (ver maintenance.ts).
  log("mantenimiento", { status: response.status, report: body.slice(0, 2_000) });
  // Un barrido que falló marca la ejecución del cron como fallida en el panel de Cloudflare.
  if (!response.ok) throw new Error(`El mantenimiento respondió ${response.status}.`);
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
