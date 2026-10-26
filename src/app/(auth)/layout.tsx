import type { ReactNode } from "react";
import { PublicShell } from "@/components/site-shell";
import { TurnstileProvider } from "@/components/turnstile";
import { getViewer } from "@/lib/auth/viewer";
import { runtimeEnv } from "@/lib/runtime-env";

export default async function AuthLayout({
  children,
}: {
  children: ReactNode;
}) {
  const viewer = await getViewer();
  // La clave pública de Turnstile se lee en el servidor (no en el build): ver src/components/turnstile.tsx.
  const turnstileSiteKey = runtimeEnv().TURNSTILE_SITE_KEY?.trim() || null;
  return (
    <PublicShell viewer={viewer}>
      <TurnstileProvider siteKey={turnstileSiteKey}>{children}</TurnstileProvider>
    </PublicShell>
  );
}
