import { AuthFrame } from "@/components/auth-ui";
import { LoginForm } from "./login-form";

export const metadata = { title: "Ingresar" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; redirectTo?: string }>;
}) {
  const { error, redirectTo } = await searchParams;

  return (
    <AuthFrame>
      <LoginForm
        notice={
          error === "enlace_invalido"
            ? "El enlace no es válido o ya venció. Pedí uno nuevo."
            : undefined
        }
        redirectTo={redirectTo}
      />
    </AuthFrame>
  );
}
