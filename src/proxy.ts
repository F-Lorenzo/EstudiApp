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

export async function proxy(request: NextRequest) {
  const matchedRoute = ROLE_ROUTE_PREFIXES.find(({ prefix }) =>
    request.nextUrl.pathname.startsWith(prefix),
  );

  if (!matchedRoute) {
    return NextResponse.next();
  }

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

  if (!user) {
    const redirectUrl = new URL(LOGIN_PATH, request.url);
    redirectUrl.searchParams.set("redirectTo", request.nextUrl.pathname);
    return NextResponse.redirect(redirectUrl);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== matchedRoute.role) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/alumno/:path*", "/docente/:path*", "/admin/:path*"],
};
