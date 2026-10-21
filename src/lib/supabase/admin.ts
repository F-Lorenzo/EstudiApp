import { createClient } from "@supabase/supabase-js";
import { runtimeEnv } from "@/lib/runtime-env";

/**
 * Cliente con la service role key: se salta la RLS. Solo para código de
 * servidor que actúa como el sistema (webhooks de pago, pago simulado en
 * desarrollo). Nunca se importa desde un componente de cliente; la variable no
 * lleva el prefijo NEXT_PUBLIC_, así que tampoco llega al navegador.
 */
export function createAdminClient() {
  const env = runtimeEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY para esta operación.");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
