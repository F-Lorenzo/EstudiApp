import Link from "next/link";
import { SignOutButton } from "@/components/sign-out-button";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let fullName: string | null = null;

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .single();

    fullName = profile?.full_name ?? null;
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold">EstudiApp</h1>

      <Link href="/docentes" className="text-sm underline">
        Buscar docentes
      </Link>

      {user ? (
        <div className="space-y-3">
          <p>Hola{fullName ? `, ${fullName}` : ""}.</p>
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
