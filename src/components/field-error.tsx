export function FieldError({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null;

  return <p className="mt-1 text-sm text-red-600">{messages[0]}</p>;
}
