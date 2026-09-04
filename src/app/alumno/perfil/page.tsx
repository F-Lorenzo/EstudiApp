import { getMockSession } from "@/lib/mock/session";
import { ProfileForm } from "./profile-form";

export default async function PerfilAlumnoPage() {
  const profile = await getMockSession();

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Mi perfil</h1>
      <ProfileForm
        email={profile?.email ?? ""}
        fullName={profile?.full_name ?? ""}
        avatarUrl={profile?.avatar_url ?? ""}
      />
    </div>
  );
}
