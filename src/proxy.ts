import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type UserRole = "alumno" | "docente" | "administrador";

// Prefijos de ruta privada y el rol que requieren (sección 2: protección de
// rutas privadas según el rol del usuario alumno / docente / administrador).
const ROLE_ROUTE_PREFIXES: { prefix: string; role: UserRole }[] = [
  { prefix: "/alumno", role: "alumno" },
  { prefix: "/docente", role: "docente" },
  { prefix: "/admin", role: "administrador" },
];

const LOGIN_PATH = "/login";

// El prefijo debe coincidir por segmento completo: «/docente» protege
// «/docente/perfil», pero no el catálogo público «/docentes».
function matchesPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * Corre en todas las rutas de página. Las páginas públicas también leen la
 * sesión (para mostrar «Mi espacio» en la cabecera), y refrescar un token
 * vencido solo se puede persistir acá: desde un Server Component no se pueden
 * escribir cookies. Además exige sesión y rol en las rutas privadas.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const matchedRoute = ROLE_ROUTE_PREFIXES.find(({ prefix }) =>
    matchesPrefix(request.nextUrl.pathname, prefix),
  );

  if (!matchedRoute) {
    return response;
  }

  // Las redirecciones también deben llevar las cookies de sesión refrescadas.
  const redirectTo = (url: URL) => {
    const redirectResponse = NextResponse.redirect(url);
    response.cookies
      .getAll()
      .forEach((cookie) => redirectResponse.cookies.set(cookie));
    return redirectResponse;
  };

  if (!user) {
    const redirectUrl = new URL(LOGIN_PATH, request.url);
    // Con la consulta incluida: después de ingresar vuelve al mismo lugar
    // (por ejemplo, a la reserva de un horario elegido).
    redirectUrl.searchParams.set(
      "redirectTo",
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
    );
    return redirectTo(redirectUrl);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== matchedRoute.role) {
    return redirectTo(new URL("/", request.url));
  }

  return response;
}

export const config = {
  // Todo menos los archivos estáticos y las imágenes de marca.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|brand/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map)$).*)",
  ],
};
