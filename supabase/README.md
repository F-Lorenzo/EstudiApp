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
   SQL Editor del dashboard. (Alternativa con la CLI: ver más abajo.)

   **Proyecto nuevo y vacío:** `npm run db:bundle -- 1 11` genera
   `supabase/aplicar-0001-a-0011.sql` (con `--compacto`, la misma versión sin
   comentarios).

   **Proyecto que ya tiene hasta la 0010** (el de EstudiApp hoy):
   `npm run db:bundle -- 11 11` genera `supabase/aplicar-0011-a-0011.sql` con
   los cimientos del cobro. Corré antes `supabase/checks/1-diagnostico.sql`:
   su última fila te dice qué comando usar. Se pega entero y se corre una vez, dentro de una transacción.
   Una prueba automática (`supabase/tests/fresh-install.db.mjs`) comprueba que
   el resultado es idéntico a aplicar todas las migraciones una por una.

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
- `0011_payments_foundation.sql`: cimientos del cobro con Mercado Pago (no
  conecta con Mercado Pago ni cambia lo que puede hacer un alumno). La
  comisión de la plataforma (12 %) pasa a una función y **cada reserva guarda
  la tasa del momento en que se creó**, así que cambiarla más adelante (por
  reputación) no toca las reservas hechas; `confirm_booking_payment` valida la
  comisión contra esa tasa. Agrega la política de reembolsos
  (`refund_percent`: 100 % con 24 h o más, 50 % con 2 h o más, 0 % después;
  el docente y la administración, siempre 100 %), la cola de reembolsos
  (`refunds`, con clave de idempotencia, y `mark_refund_result`), los tokens
  de Mercado Pago de cada docente (`mp_credentials`, que ni el propio docente
  puede leer) y los avisos de pago idempotentes (`begin_payment_event`,
  `finish_payment_event`). `cancel_booking` no cambia: una reserva paga sigue
  sin poder cancelarse hasta la 0012 (cancelación con reembolso). Detalle del
  diseño en [docs/FASE-1-PLAN.md](../docs/FASE-1-PLAN.md).

Las migraciones 0006 a 0011 se probaron con más de 300 comprobaciones (más la matriz de la RLS: 553 intentos por rol) en un Postgres real
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
de confirmación de registro y recuperación de contraseña pasen por
`/auth/confirm` con el tipo **escrito fijo** en cada plantilla:

- *Confirm signup*: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`
- *Reset password*: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`

(Una versión anterior de esta guía decía `type={{ .Type }}`: esa variable
no figura entre las que documenta Supabase para las plantillas; con el tipo
escrito fijo el link funciona seguro.) Por
defecto Supabase usa `{{ .ConfirmationURL }}`, que apunta a un endpoint
propio en vez de a la app. El texto completo de las dos plantillas está en
[docs/FASE-0-PASO-A-PASO.md](../docs/FASE-0-PASO-A-PASO.md), paso 6.

## Consultas para el SQL Editor (`supabase/checks`)

- `1-diagnostico.sql`: qué migraciones tiene el proyecto y qué hacer a continuación.
- `2-verificacion.sql`: después de aplicar, comprueba la RLS, los permisos, las guardas y los datos
  que hay que revisar a mano. Cada fila tiene que decir OK.

Las dos solo leen y se prueban en cada estado posible de la base (`supabase/tests/checks.db.mjs`).
