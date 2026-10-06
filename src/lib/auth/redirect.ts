import { homeFor, type UserRole } from "./roles";

/**
 * Devuelve `requested` solo si es una ruta interna segura, o `null`. Descarta
 * URLs absolutas, `//otro-sitio`, barras invertidas y caracteres de control
 * (los navegadores ignoran tabulaciones y saltos de línea al interpretar una
 * URL, así que `/\t/otro-sitio` terminaría fuera del sitio), y confirma que
 * resuelta contra un origen fijo siga siendo del mismo origen.
 */
export function safeInternalPath(requested: unknown) {
  if (
    typeof requested !== "string" ||
    !requested.startsWith("/") ||
    requested.startsWith("//") ||
    /[\\\u0000-\u001f\u007f]/.test(requested)
  ) {
    return null;
  }
  try {
    const base = "http://localhost";
    return new URL(requested, base).origin === base ? requested : null;
  } catch {
    return null;
  }
}

/** Destino después de iniciar sesión: la ruta pedida si es segura, o el inicio del rol. */
export function postLoginPath(requested: unknown, role: UserRole) {
  return safeInternalPath(requested) ?? homeFor(role);
}
