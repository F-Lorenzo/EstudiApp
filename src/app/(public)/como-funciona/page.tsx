import { HowItWorks } from "@/components/how-it-works";

export const metadata = { title: "Cómo funciona" };

export default async function ComoFuncionaPage({
  searchParams,
}: {
  searchParams: Promise<{ rol?: string }>;
}) {
  const { rol } = await searchParams;
  const role = rol === "docente" || rol === "teacher" ? "teacher" : "learner";
  // `key` reinicia la pestaña elegida cuando cambia ?rol= sin recargar la página.
  return <HowItWorks key={role} initialRole={role} />;
}
