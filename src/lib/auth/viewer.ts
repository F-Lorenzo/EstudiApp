import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { UserRole, Viewer } from "./roles";

/**
 * Persona autenticada (o `null`). Se memoiza por request: el layout y la
 * página pueden pedirla sin repetir las consultas a Supabase.
 */
export const getViewer = cache(async (): Promise<Viewer> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role")
    .eq("id", user.id)
    .single<{ full_name: string; role: UserRole }>();

  return {
    id: user.id,
    name: profile?.full_name || user.email || "Mi cuenta",
    role: profile?.role ?? "alumno",
  };
});
