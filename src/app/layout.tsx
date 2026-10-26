import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/figtree";
import "./globals.css";
// Las clases de cada área comparten primitives (botones, tarjetas, avisos),
// así que se cargan una sola vez desde la raíz.
import "@/components/home.css";
import "@/components/public-pages.css";
import "@/components/student-pages.css";
import "@/components/management-pages.css";
import { siteUrlOrNull } from "@/lib/payments/site-url";
import { runtimeEnv } from "@/lib/runtime-env";
import { siteIndexable } from "@/lib/seo/indexing";

const baseMetadata: Metadata = {
  title: {
    default: "EstudiApp — Aprender también es avanzar",
    template: "%s · EstudiApp",
  },
  description:
    "Encontrá profesores con trayectoria comprobada. Aprendé a tu ritmo, con alguien que sabe cómo acompañarte.",
  icons: {
    icon: [{ url: "/brand/isotype-official.png", type: "image/png" }],
  },
};

// Se arma en cada pedido: la indexación es un interruptor del Worker (`SITE_INDEXABLE`, src/lib/seo/indexing.ts),
// apagado hasta el lanzamiento.
export async function generateMetadata(): Promise<Metadata> {
  const env = runtimeEnv();
  const indexable = siteIndexable(env, (await headers()).get("host"));
  const site = siteUrlOrNull(env);
  return {
    ...baseMetadata,
    ...(site ? { metadataBase: new URL(site) } : {}),
    robots: indexable ? { index: true, follow: true } : { index: false, follow: false },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#023618",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-AR" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
