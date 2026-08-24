import { z } from "zod";

// Requisitos mínimos de contraseña (sección 2: "contraseña con requisitos mínimos")
const passwordSchema = z
  .string()
  .min(8, "La contraseña debe tener al menos 8 caracteres");

export const loginSchema = z.object({
  email: z.email("Ingresá un email válido"),
  password: z.string().min(1, "Ingresá tu contraseña"),
});

export const registerAlumnoSchema = z
  .object({
    fullName: z.string().trim().min(1, "Ingresá tu nombre completo"),
    email: z.email("Ingresá un email válido"),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Las contraseñas no coinciden",
    path: ["confirmPassword"],
  });

export const registerDocenteSchema = registerAlumnoSchema;

export const requestPasswordResetSchema = z.object({
  email: z.email("Ingresá un email válido"),
});

export const updateProfileSchema = z.object({
  fullName: z.string().trim().min(1, "Ingresá tu nombre completo"),
  avatarUrl: z.union([z.url("Ingresá una URL válida"), z.literal("")]),
});

export const updatePasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Las contraseñas no coinciden",
    path: ["confirmPassword"],
  });
