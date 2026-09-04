import { createClient } from "@/lib/supabase/server";
import { ProfileForm } from "./profile-form";

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
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Mi perfil</h1>
      <ProfileForm
        email={user!.email ?? ""}
        fullName={profile?.full_name ?? ""}
        avatarUrl={profile?.avatar_url ?? ""}
      />
    </div>
  );
}
