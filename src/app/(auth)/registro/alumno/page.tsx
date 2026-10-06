import { AuthFrame } from "@/components/auth-ui";
import { RegisterForm } from "../register-form";

export const metadata = { title: "Creá tu cuenta" };

export default function RegistroAlumnoPage() {
  return (
    <AuthFrame role="learner">
      <RegisterForm role="alumno" />
    </AuthFrame>
  );
}
