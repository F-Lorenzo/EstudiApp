import Link from "next/link";
import { SignOutButton } from "@/components/sign-out-button";

export default function AlumnoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <nav className="flex items-center justify-between border-b px-6 py-4">
        <div className="flex gap-4 text-sm">
          <Link href="/alumno/proximas-clases">Próximas clases</Link>
          <Link href="/alumno/historial">Historial</Link>
          <Link href="/alumno/perfil">Mi perfil</Link>
        </div>
        <SignOutButton />
      </nav>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
