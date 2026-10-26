import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { siteUrl } from "@/lib/payments/site-url";
import { runtimeEnv } from "@/lib/runtime-env";
import { PUBLIC_PATHS, siteIndexable } from "@/lib/seo/indexing";
import { createClient } from "@/lib/supabase/server";

/** Las páginas públicas y el perfil de cada docente aprobado. Vacío mientras la indexación esté apagada. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const env = runtimeEnv();
  if (!siteIndexable(env, (await headers()).get("host"))) return [];
  const site = siteUrl(env);
  const supabase = await createClient();
  // La vista solo trae docentes aprobados (y corre con los permisos del visitante).
  const { data } = await supabase.from("tutor_catalog").select("id").order("id").limit(5000);
  return [
    ...PUBLIC_PATHS.map((path) => ({ url: `${site}${path}` })),
    ...(data ?? []).map((tutor: { id: string }) => ({ url: `${site}/docentes/${tutor.id}` })),
  ];
}
