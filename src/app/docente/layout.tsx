import Link from "next/link";
import { SignOutButton } from "@/components/sign-out-button";

export default function DocenteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <nav className="flex items-center justify-between border-b-2 border-black px-6 py-4">
        <div className="flex gap-4 text-sm">
          <Link href="/docente/perfil">Mi perfil</Link>
        </div>
        <SignOutButton />
      </nav>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
