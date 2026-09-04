import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/mock/session";
import { PROFILES } from "@/lib/mock/data";

type UserRole = "alumno" | "docente" | "administrador";

// Prefijos de ruta privada y el rol que requieren (sección 2: protección de
// rutas privadas según el rol del usuario alumno / docente / administrador).
//
// MOCK — SIN DB: la sesión es una cookie con el id de perfil (ver
// src/lib/mock/session.ts) en vez de una sesión real de Supabase Auth.
const ROLE_ROUTE_PREFIXES: { prefix: string; role: UserRole }[] = [
  { prefix: "/alumno", role: "alumno" },
  { prefix: "/docente", role: "docente" },
  { prefix: "/admin", role: "administrador" },
];

const LOGIN_PATH = "/login";

export function proxy(request: NextRequest) {
  const matchedRoute = ROLE_ROUTE_PREFIXES.find(({ prefix }) =>
    request.nextUrl.pathname.startsWith(prefix),
  );

  if (!matchedRoute) {
    return NextResponse.next();
  }

  const userId = request.cookies.get(SESSION_COOKIE)?.value;
  const profile = userId ? PROFILES.find((p) => p.id === userId) : null;

  if (!profile) {
    const redirectUrl = new URL(LOGIN_PATH, request.url);
    redirectUrl.searchParams.set("redirectTo", request.nextUrl.pathname);
    return NextResponse.redirect(redirectUrl);
  }

  if (profile.role !== matchedRoute.role) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/alumno/:path*", "/docente/:path*", "/admin/:path*"],
};
