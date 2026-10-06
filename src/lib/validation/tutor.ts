import { z } from "zod";

// Campos de referencia de la sección 4 de la spec. La lista final de
// campos queda pendiente de definir con el cliente (tarjeta de
// Fundaciones); esto cubre el mínimo indicado en el documento mientras
// tanto.
export const tutorProfileSchema = z.object({
  fullName: z.string().trim().min(1, "Ingresá tu nombre completo"),
  avatarUrl: z.union([z.url({ protocol: /^https?$/, error: "Ingresá un enlace válido que empiece con http o https" }), z.literal("")]),
  bio: z.string().trim().min(1, "Contanos tu presentación"),
  nivelAcademico: z.string().trim().min(1, "Ingresá tu nivel académico o título"),
  credentialUrl: z.union([z.url({ protocol: /^https?$/, error: "Ingresá un enlace válido que empiece con http o https" }), z.literal("")]),
  tarifaPorClase: z.coerce
    .number()
    .positive("La tarifa debe ser mayor a cero"),
  contactoVerificacion: z
    .string()
    .trim()
    .min(1, "Ingresá un dato de contacto para verificarte"),
  subjectIds: z.array(z.string()).min(1, "Elegí al menos una materia"),
});
