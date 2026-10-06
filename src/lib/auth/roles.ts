export type UserRole = "alumno" | "docente" | "administrador";

/** Persona con sesión iniciada, tal como la necesita la interfaz. */
export type Viewer = { id: string; name: string; role: UserRole } | null;

/** Pantalla de inicio de cada rol. */
export function homeFor(role: UserRole) {
  return role === "administrador"
    ? "/admin/docentes/pendientes"
    : role === "docente"
      ? "/docente"
      : "/alumno";
}
