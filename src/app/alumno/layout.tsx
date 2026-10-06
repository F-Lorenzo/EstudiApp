import type { ReactNode } from "react";
import { AppShell } from "@/components/site-shell";
import { getViewer } from "@/lib/auth/viewer";

export default async function AlumnoLayout({
  children,
}: {
  children: ReactNode;
}) {
  const viewer = await getViewer();
  return (
    <AppShell role="alumno" name={viewer?.name ?? "Mi cuenta"}>
      {children}
    </AppShell>
  );
}
