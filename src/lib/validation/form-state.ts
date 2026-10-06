export type ActionState = {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  success?: boolean;
  /**
   * Valores enviados (nunca contraseñas). React 19 vacía los campos de un
   * formulario después de cada acción; con esto la pantalla puede volver a
   * rellenarlos cuando hay un error.
   */
  values?: Record<string, string>;
};

export const initialActionState: ActionState = {};

/** Copia los campos de texto indicados de un formulario, para devolverlos en el estado. */
export function echoValues(formData: FormData, keys: string[]) {
  const values: Record<string, string> = {};
  for (const key of keys) {
    const value = formData.get(key);
    if (typeof value === "string") values[key] = value;
  }
  return values;
}
