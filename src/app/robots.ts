import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { siteUrl } from "@/lib/payments/site-url";
import { runtimeEnv } from "@/lib/runtime-env";
import { PRIVATE_PATHS, siteIndexable } from "@/lib/seo/indexing";

/** `robots.txt`: todo cerrado hasta que se encienda la indexación (`SITE_INDEXABLE`); después, todo menos lo privado. */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const env = runtimeEnv();
  if (!siteIndexable(env, (await headers()).get("host"))) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    rules: { userAgent: "*", allow: "/", disallow: PRIVATE_PATHS },
    sitemap: `${siteUrl(env)}/sitemap.xml`,
  };
}
