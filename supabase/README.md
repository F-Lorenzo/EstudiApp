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
3. Aplicar las migraciones (`supabase/migrations/0001` a `0010`) en el
   SQL Editor del dashboard, en orden, pegando el contenido de cada
   archivo. (Alternativa con la CLI: ver más abajo.)

   **Si el proyecto ya tiene las migraciones 0001 a 0005** (y datos), no
   hace falta pegar de a una: `npm run db:bundle` genera
   `supabase/aplicar-0006-a-0010.sql`, un único archivo que se pega y se corre
   de una vez. Va dentro de una transacción (si algo falla no queda nada a
   medias) y en su encabezado trae dos consultas de control para correr antes:
   franjas duplicadas (la 0007 se corta si las hay) y reservas «confirmada»
   sin pago aprobado (un resto del hueco anterior a la 0008, para revisar a
   mano). El archivo es generado y no se guarda en git.
4. Cargar datos de mock para la demo (ver `scripts/seed-demo.mjs`).
   **Solo en un proyecto de desarrollo**: el script crea cuentas con datos
   falsos y se niega a correr si no confirmás el host del proyecto.

   ```bash
   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
   SEED_DEMO_CONFIRM=<host del proyecto, por ejemplo abcd1234.supabase.co> \
   npm run seed:demo
   ```

   La service role key está en Project Settings → API → service_role.
   No hace falta ponerla en `.env.local` para esto — pasarla solo en la
   línea de comando evita dejarla guardada en un archivo.
5. `npm run dev` y entrar con cualquiera de las cuentas que imprime el
   script. Todas comparten una contraseña **aleatoria que se genera en cada
   ejecución** y se muestra solo en la consola (el repo es público, así que
   no hay una contraseña fija). Para elegir una vos, definí
   `SEED_DEMO_PASSWORD`.

Para sacar los datos de mock después de la demo (pide la misma confirmación):

```bash
NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
SEED_DEMO_CONFIRM=<host del proyecto> npm run seed:demo:cleanup
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
- `0006_visibility_and_hardening.sql`: políticas que la interfaz necesita
  (el alumno ve sus reservas, la administración ve las materias de un
  docente pendiente), guardas contra el cambio de rol y de estado de
  verificación desde la API, y cálculo automático de `rating_promedio`.
  **Es necesaria para que «Mi espacio» del alumno y la ficha de revisión
  funcionen.**
- `0007_availability_unique_slot.sql`: índice único (docente, hora de
  inicio) para que «Mi disponibilidad» no cree franjas duplicadas. Antes
  de aplicarlo, comprobá que no haya duplicados (la consulta está en el
  archivo).
- `0008_booking_system.sql`: sistema de reservas. Las reservas dejan de
  escribirse directo desde la API (tampoco la administración) y pasan por
  funciones: `create_booking` (retiene el horario 15 minutos, tope de dos
  reservas sin pagar, idempotente), `cancel_booking`, `sync_bookings` (libera
  las reservas vencidas y completa las clases terminadas) y
  `confirm_booking_payment` (solo service role, para el webhook de pago:
  valida vencimiento, monto y comisión). La reserva guarda su propio horario
  y precio, así que cerrar una franja ya no borra una reserva cancelada.
  También permite volver a reservar un horario cuya reserva se canceló, y
  que el alumno siga viendo a su docente (y el docente a sus alumnos).
- `0009_tutor_creation_guards.sql`: una cuenta ya no puede crearse un perfil
  de docente «aprobado» ni con cuenta de cobro propia, y una calificación
  solo se puede dar al docente de esa clase. **Conviene aplicarla junto con
  la 0008**: sin ella, el sistema de reservas cobraría a docentes que nadie
  revisó.

- `0010_tutor_private_data.sql`: el contacto de verificación, el respaldo y
  la cuenta de Mercado Pago de un docente salen de `tutor_profiles` (legible
  por cualquiera con la clave pública) y pasan a `tutor_private`, que solo
  lee el propio docente y la administración. Copia los datos existentes
  antes de borrar las columnas. La cuenta de Mercado Pago solo la puede
  fijar el backend (service role) o la administración. **Aplicala antes de
  guardar credenciales de cobro de cualquier docente.**

Las migraciones 0006 a 0010 se probaron con 250 comprobaciones (más la matriz de la RLS: 497 intentos por rol) en un Postgres real
(roles anónimo, alumno, docente, administrador y service role; ver
[tests/README.md](tests/README.md) y `npm run test:db`), pero **no contra tu
proyecto de Supabase**: revisalas y probalas en un proyecto de prueba antes de
aplicarlas en el real.

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
