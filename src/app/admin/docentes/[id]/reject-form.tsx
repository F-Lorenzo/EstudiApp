"use client";

import { useActionState, useState } from "react";
import { FieldError } from "@/components/field-error";
import { initialActionState } from "@/lib/validation/form-state";
import { rejectTutor } from "./actions";

export function RejectForm({ tutorId }: { tutorId: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    rejectTutor.bind(null, tutorId),
    initialActionState,
  );

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border-2 border-black px-3 py-2 text-black hover:bg-black hover:text-white"
      >
        Rechazar
      </button>
    );
  }

  return (
    <form action={formAction} className="space-y-2">
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <label htmlFor="reason" className="block text-sm font-medium">
        Motivo del rechazo
      </label>
      <textarea
        id="reason"
        name="reason"
        required
        rows={3}
        className="w-full border-2 border-black px-3 py-2"
      />
      <FieldError messages={state.fieldErrors?.reason} />
      <button
        type="submit"
        disabled={pending}
        className="border-2 border-black bg-white px-3 py-2 text-black hover:bg-black hover:text-white disabled:opacity-50"
      >
        {pending ? "Rechazando..." : "Confirmar rechazo"}
      </button>
    </form>
  );
}
