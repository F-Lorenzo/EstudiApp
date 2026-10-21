import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { runtimeEnv } from "@/lib/runtime-env";

export async function createClient() {
  const cookieStore = await cookies();
  const env = runtimeEnv();

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL!,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Ignorado: se llama desde un Server Component sin acceso de escritura
            // a cookies. El middleware se encarga de refrescar la sesión en ese caso.
          }
        },
      },
    },
  );
}
