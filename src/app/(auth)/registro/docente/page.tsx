import { AuthFrame } from "@/components/auth-ui";
import { RegisterForm } from "../register-form";

export const metadata = { title: "Creá tu cuenta docente" };

export default function RegistroDocentePage() {
  return (
    <AuthFrame role="teacher">
      <RegisterForm role="docente" />
    </AuthFrame>
  );
}
