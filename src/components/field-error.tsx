/** Primer mensaje de error de un campo (viene de la validación con Zod en el servidor). */
export function FieldError({
  messages,
  id,
}: {
  messages?: string[];
  id?: string;
}) {
  if (!messages?.length) return null;

  return (
    <span className="field-error" id={id} role="alert">
      {messages[0]}
    </span>
  );
}
