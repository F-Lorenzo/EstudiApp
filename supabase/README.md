# Supabase — EstudiApp

Este directorio contiene las migraciones SQL del modelo de datos base
(tarjeta "Modelo de datos base") y las políticas RLS (tarjeta "Políticas
RLS base") de Trello. La creación del proyecto de Supabase en sí queda
pendiente (tarjeta "Setup de Supabase").

## Guía rápida para levantar una demo hoy

1. Crear el proyecto en https://supabase.com/dashboard (tarda ~2 min en
   aprovisionarse).
2. `cp .env.local.example .env.local` y completar `NEXT_PUBLIC_SUPABASE_URL`
   y `NEXT_PUBLIC_SUPABASE_ANON_KEY` desde Project Settings → API.
3. Aplicar las migraciones (`supabase/migrations/0001` a `0005`) en el
   SQL Editor del dashboard, en orden, pegando el contenido de cada
   archivo. (Alternativa con la CLI: ver más abajo.)
4. Cargar datos de mock para la demo (ver `scripts/seed-demo.mjs`):

   ```bash
   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run seed:demo
   ```

   La service role key está en Project Settings → API → service_role.
   No hace falta ponerla en `.env.local` para esto — pasarla solo en la
   línea de comando evita dejarla guardada en un archivo.
5. `npm run dev` y entrar con cualquiera de las cuentas que imprime el
   script (todas comparten la contraseña `Demo1234!`).

Para sacar los datos de mock después de la demo:

```bash
NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run seed:demo:cleanup
```

Eso borra únicamente los usuarios `*.demo@estudiapp.test` (y en cascada
sus perfiles, reservas, etc.) — no toca datos reales. Cuando ya no se
necesite más el modo demo, alcanza con borrar `scripts/seed-demo.mjs` y
las dos entradas `seed:demo*` de `package.json`.

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
- `0004_tutor_profile_extras.sql`: columna `credential_url` + semilla
  del catálogo de materias.
- `0005_tutor_catalog_view.sql`: vista `tutor_catalog` para el buscador
  público de docentes.

## Paso manual pendiente: asignar el rol administrador

No hay alta pública de administradores (por seguridad, el trigger de
registro nunca asigna ese rol). Para convertir un usuario ya registrado
en administrador, correr en el SQL editor del dashboard:

```sql
update public.profiles set role = 'administrador' where id = '<uuid del usuario>';
```

## Paso manual pendiente: templates de email

El flujo de auth (`src/app/auth/confirm/route.ts`) espera que los emails
de confirmación de registro y recuperación de contraseña linkeen a
`{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type={{ .Type }}`.
Por defecto, Supabase usa `{{ .ConfirmationURL }}`, que apunta a un
endpoint propio de Supabase en vez de a la app. Hay que editar los
templates "Confirm signup" y "Reset password" en
Authentication → Email Templates del dashboard para usar la URL de
arriba.
