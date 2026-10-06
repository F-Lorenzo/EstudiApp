import { ButtonLink, Icon, PageHeading } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { ProfileForm } from "./profile-form";

export const metadata = { title: "Mi perfil" };

export default async function PerfilAlumnoPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, avatar_url")
    .eq("id", user!.id)
    .single();

  return (
    <div className="stu-page">
      <PageHeading
        eyebrow="MI PERFIL"
        title="Este es tu punto de partida."
        description="Tus datos para que cada clase tenga más contexto."
      />
      <div className="stu-profile-layout">
        <ProfileForm
          email={user!.email ?? ""}
          fullName={profile?.full_name ?? ""}
          avatarUrl={profile?.avatar_url ?? ""}
        />
        <aside className="stu-profile-aside">
          <Icon name="book" size={40} />
          <h2>
            No hace falta
            <br />
            saber por dónde
            <br />
            empezar.
          </h2>
          <p>
            Para eso también está tu profe. Completá tu perfil con lo que sabés
            hoy; el resto lo construís aprendiendo.
          </p>
          <ButtonLink href="/docentes" variant="secondary">
            Encontrar mi profe <Icon name="arrow-right" size={17} />
          </ButtonLink>
        </aside>
      </div>
    </div>
  );
}
