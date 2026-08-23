# Supabase — EstudiApp

Este directorio contiene las migraciones SQL del modelo de datos base
(tarjeta "Modelo de datos base") y las políticas RLS (tarjeta "Políticas
RLS base") de Trello. La creación del proyecto de Supabase en sí queda
pendiente (tarjeta "Setup de Supabase").

## Pendiente (a cargo del owner del proyecto)

1. Crear el proyecto en https://supabase.com/dashboard.
2. Copiar `.env.local.example` a `.env.local` y completar:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (solo backend, nunca exponer al cliente)
3. Aplicar las migraciones de `supabase/migrations/` contra el proyecto,
   por ejemplo con la Supabase CLI:

   ```bash
   supabase link --project-ref <project-ref>
   supabase db push
   ```

## Migraciones incluidas

- `0001_initial_schema.sql`: tablas base (perfiles, docentes, materias,
  disponibilidad, reservas, pagos, videollamada, calificaciones).
- `0002_rls_policies.sql`: Row Level Security por tabla, acorde a los
  roles alumno / docente / administrador (sección 16 de la spec).
- `0003_handle_new_user.sql`: trigger que crea `profiles` (y
  `tutor_profiles` si el rol es docente) al registrarse.

## Paso manual pendiente: templates de email

El flujo de auth (`src/app/auth/confirm/route.ts`) espera que los emails
de confirmación de registro y recuperación de contraseña linkeen a
`{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type={{ .Type }}`.
Por defecto, Supabase usa `{{ .ConfirmationURL }}`, que apunta a un
endpoint propio de Supabase en vez de a la app. Hay que editar los
templates "Confirm signup" y "Reset password" en
Authentication → Email Templates del dashboard para usar la URL de
arriba.
