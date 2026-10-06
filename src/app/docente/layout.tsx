import type { ReactNode } from "react";
import { AppShell } from "@/components/site-shell";
import { getViewer } from "@/lib/auth/viewer";

export default async function DocenteLayout({
  children,
}: {
  children: ReactNode;
}) {
  const viewer = await getViewer();
  return (
    <AppShell role="docente" name={viewer?.name ?? "Mi cuenta"}>
      {children}
    </AppShell>
  );
}
