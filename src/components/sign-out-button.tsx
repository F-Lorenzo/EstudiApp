import { signOut } from "@/lib/auth/actions";

export function SignOutButton() {
  return (
    <form action={signOut}>
      <button type="submit" className="text-sm underline">
        Cerrar sesión
      </button>
    </form>
  );
}
