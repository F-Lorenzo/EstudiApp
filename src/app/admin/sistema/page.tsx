import { getCloudflareContext } from "@opennextjs/cloudflare";
import { SystemStatus } from "@/components/admin-system";
import { getSystemStatus, pendingChecks } from "@/lib/admin/system-status";
import { runtimeEnv } from "@/lib/runtime-env";
import { isRateLimiter } from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Sistema" };

/** Los limitadores de `wrangler.jsonc` solo existen dentro del Worker. */
function rateLimitersAvailable() {
  try {
    const env = getCloudflareContext().env as unknown as Record<string, unknown>;
    return isRateLimiter(env.LOGIN_RATE_LIMITER) && isRateLimiter(env.SIGNUP_RATE_LIMITER);
  } catch {
    return false;
  }
}

export default async function SistemaPage() {
  const supabase = await createClient();
  // La última migración (0025) agrega la búsqueda del catálogo: si responde, la base está al día.
  const { error } = await supabase.rpc("search_tutor_catalog", { p_limit: 1 });
  const databaseCurrent = !error ? true : error.code === "PGRST202" ? false : null;

  const groups = getSystemStatus({ env: runtimeEnv(), rateLimiters: rateLimitersAvailable(), databaseCurrent });
  return <SystemStatus groups={groups} pending={pendingChecks(groups)} />;
}
