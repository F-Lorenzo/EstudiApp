import Link from "next/link";
import { SignOutButton } from "@/components/sign-out-button";
import { getMockSession } from "@/lib/mock/session";

const DASHBOARD_BY_ROLE: Record<string, { href: string; label: string }> = {
  alumno: { href: "/alumno/proximas-clases", label: "Ir a mi panel de alumno" },
  docente: { href: "/docente/perfil", label: "Ir a mi panel de docente" },
  administrador: { href: "/admin/docentes/pendientes", label: "Ir al panel de administrador" },
};

export default async function Home() {
  const profile = await getMockSession();
  const dashboard = profile ? DASHBOARD_BY_ROLE[profile.role] : null;

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold">EstudiApp</h1>

      <Link href="/docentes" className="text-sm underline">
        Buscar docentes
      </Link>

      {profile ? (
        <div className="space-y-3">
          <p>Hola, {profile.full_name}.</p>
          {dashboard && (
            <p>
              <Link href={dashboard.href} className="text-sm underline">
                {dashboard.label}
              </Link>
            </p>
          )}
          <SignOutButton />
        </div>
      ) : (
        <div className="flex gap-4 text-sm underline">
          <Link href="/login">Iniciar sesión</Link>
          <Link href="/registro/alumno">Crear cuenta</Link>
        </div>
      )}
    </main>
  );
}
