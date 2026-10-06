import type { ReactNode } from "react";
import { AppShell } from "@/components/site-shell";
import { getViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const viewer = await getViewer();
  const supabase = await createClient();
  const { count } = await supabase
    .from("tutor_profiles")
    .select("*", { count: "exact", head: true })
    .eq("verification_status", "pendiente");

  return (
    <AppShell
      role="administrador"
      name={viewer?.name ?? "Equipo EstudiApp"}
      pendingCount={count ?? 0}
    >
      {children}
    </AppShell>
  );
}
