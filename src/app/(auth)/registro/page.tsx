import { redirect } from "next/navigation";

// Punto de entrada único (/registro y /registro?rol=docente): deriva a la
// pantalla de cada rol, que es donde viven las acciones de alta.
export default async function RegistroPage({
  searchParams,
}: {
  searchParams: Promise<{ rol?: string }>;
}) {
  const { rol } = await searchParams;
  redirect(
    rol === "docente" || rol === "teacher"
      ? "/registro/docente"
      : "/registro/alumno",
  );
}
