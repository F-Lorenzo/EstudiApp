import { z } from "zod";

export const rejectTutorSchema = z.object({
  reason: z.string().trim().min(1, "Ingresá el motivo del rechazo"),
});
