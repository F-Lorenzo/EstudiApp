import { AuthFrame, AuthSuccess } from "@/components/auth-ui";
import { ButtonLink, Icon } from "@/components/ui";

export const metadata = { title: "Revisá tu email" };

export default function ConfirmarEmailPage() {
  return (
    <AuthFrame>
      <AuthSuccess
        eyebrow="UN NUEVO PUNTO DE PARTIDA"
        title="Revisá tu email."
        action={
          <ButtonLink href="/login">
            Ir a ingresar <Icon name="arrow-right" size={17} />
          </ButtonLink>
        }
      >
        Te enviamos un mensaje para confirmar tu cuenta. Abrí el enlace para
        activarla y después ingresá.
      </AuthSuccess>
    </AuthFrame>
  );
}
