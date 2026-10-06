import { ButtonLink, Logo } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="not-found">
      <Logo />
      <p className="eyebrow">404 · Un pequeño desvío</p>
      <h1>
        Por acá todavía
        <br />
        no hay una página.
      </h1>
      <p>Volvamos al lugar donde empieza el próximo paso.</p>
      <ButtonLink href="/">Volver al inicio</ButtonLink>
    </main>
  );
}
