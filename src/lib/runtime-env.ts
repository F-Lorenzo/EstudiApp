import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Variables disponibles para código de servidor.
 *
 * En Node/Vercel viven en `process.env`; en un Worker de Cloudflare los secretos
 * runtime viven en los bindings de OpenNext. Unificar ambas fuentes evita que el
 * código de pagos funcione localmente pero no vea los secretos ya cargados en el
 * dashboard de Cloudflare.
 */
export type RuntimeEnv = Record<string, string | undefined>;

export function runtimeEnv(): RuntimeEnv {
  const values: RuntimeEnv = { ...process.env };

  try {
    const bindings = getCloudflareContext().env as unknown as Record<string, unknown>;
    for (const [name, value] of Object.entries(bindings)) {
      if (typeof value === "string") values[name] = value;
    }
  } catch {
    // En tests, `next dev` y otros runtimes que no son Workers no hay contexto de Cloudflare.
  }

  return values;
}
