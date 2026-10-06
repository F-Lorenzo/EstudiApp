import type { Metadata, Viewport } from "next";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/figtree";
import "./globals.css";
// Las clases de cada área comparten primitives (botones, tarjetas, avisos),
// así que se cargan una sola vez desde la raíz.
import "@/components/home.css";
import "@/components/public-pages.css";
import "@/components/student-pages.css";
import "@/components/management-pages.css";

export const metadata: Metadata = {
  title: {
    default: "EstudiApp — Aprender también es avanzar",
    template: "%s · EstudiApp",
  },
  description:
    "Encontrá profesores con trayectoria comprobada. Aprendé a tu ritmo, con alguien que sabe cómo acompañarte.",
  // Producto todavía sin lanzamiento público: no indexar hasta decidirlo.
  robots: { index: false, follow: false },
  icons: {
    icon: [{ url: "/brand/isotype-official.png", type: "image/png" }],
  },
};

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
