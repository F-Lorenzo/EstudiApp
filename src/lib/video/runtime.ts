import { runtimeEnv } from "@/lib/runtime-env";
import { DailyClient } from "./daily";

/** El cliente de Daily con la clave del servidor, o `null` si falta `DAILY_API_KEY` (la sala muestra que no está disponible). */
export function createDailyClient(
  env: Record<string, string | undefined> = runtimeEnv(),
  { timeoutMs }: { timeoutMs?: number } = {},
): DailyClient | null {
  const apiKey = env.DAILY_API_KEY?.trim();
  return apiKey ? new DailyClient({ apiKey, timeoutMs }) : null;
}
