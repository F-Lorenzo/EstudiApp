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
3. Aplicar las migraciones (`supabase/migrations/0001` a `0022`) en el
   SQL Editor del dashboard. (Alternativa con la CLI: ver más abajo.)

   **Proyecto nuevo y vacío:** `npm run db:bundle -- 1 22` genera
   `supabase/aplicar-0001-a-0022.sql` (con `--compacto`, la misma versión sin
   comentarios).

   **Proyecto que ya tiene hasta la 0011** (el de EstudiApp hoy):
   `npm run db:bundle -- 12 15` genera `supabase/aplicar-0012-a-0015.sql` con
   los avisos de pago, la cancelación con reembolso, las cuentas de cobro de los
   docentes y la bandeja de emails. Corré antes `supabase/checks/1-diagnostico.sql`:
   su última fila te dice qué comando usar. Se pega entero y se corre una vez, dentro de una transacción.
   Una prueba automática (`supabase/tests/fresh-install.db.mjs`) comprueba que
   el resultado es idéntico a aplicar todas las migraciones una por una.

   **Ojo con la 0014:** desde ella no se puede reservar con un docente que no
   tenga su cuenta de Mercado Pago vinculada (`tutor_not_payable`). Si el proyecto
   ya tiene docentes y querés seguir probando reservas mientras tanto, aplicá en
   dos tandas: `npm run db:bundle -- 12 13` ahora y `npm run db:bundle -- 14 15`
   después de vincular al menos un docente de prueba.

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

   Desde la 0014 los docentes de demo traen una cuenta de cobro **de relleno**
   (cuenta `demo-…` y tokens `demo-no-usable`, sin cifrar): sirve para poder
   reservar con ellos y probar el recorrido con el pago simulado, y nunca
   sirve para cobrar ni reembolsar de verdad.
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
  sin poder cancelarse hasta la 0013 (cancelación con reembolso). Detalle del
  diseño en [docs/FASE-1-PLAN.md](../docs/FASE-1-PLAN.md).
- `0012_payment_notifications.sql`: qué hace la base con cada pago que informa
  Mercado Pago (`apply_payment_notification`). Confirma la reserva si el pago
  es aceptable, encola el reembolso total si no se puede aceptar (retención
  vencida, reserva cancelada, segundo pago, monto o moneda distintos, clase
  empezada), deja para revisión lo raro (cuenta de cobro distinta, reembolsos
  o contracargos hechos por fuera) y no hace nada ante repeticiones o avisos
  fuera de orden. Incluye `enqueue_refund` (un solo reembolso por pago). Solo
  las ejecuta la service role. No cambia lo que ven los usuarios; hace falta
  recién cuando se conecte el webhook.
- `0013_cancel_with_refund.sql`: **cancelar con reembolso.** `cancel_booking`
  deja de rechazar las reservas ya pagas (se va `refund_required`) y devuelve un
  resumen (`paid`, `percent`, `amount`, `refund`, `cancelled_by`): calcula el
  reembolso con la política (`refund_percent`; si cancela el docente o la
  administración, siempre 100 %), lo encola con `enqueue_refund` y libera el
  horario. Bloquea la reserva y el pago, así que dos cancelaciones simultáneas
  no encolan dos reembolsos. `refunds.mp_user_id` guarda la cuenta de cobro de
  la que sale la plata (`enqueue_refund` y `apply_payment_notification` la
  pasan) y `retryable_refunds` lista, para el barrido del servidor, los
  reembolsos pendientes o fallidos que conviene reintentar (solo service role).
  **Cambia el tipo de lo que devuelve `cancel_booking` (de `void` a `jsonb`):
  la app tiene que desplegarse junto con la migración.**
- `0014_payout_accounts.sql`: **cuentas de cobro de los docentes.**
  `save_mp_credentials` y `rotate_mp_tokens` (solo service role) guardan y
  renuevan las credenciales de Mercado Pago de un docente (los tokens llegan ya
  cifrados desde la app); `unlink_my_mp_account` deja que el docente desvincule
  la suya, salvo que tenga reservas por dar o reembolsos sin cerrar;
  `tutor_can_receive_payments` dice (sí o no, sin abrir la tabla) si un docente
  tiene una cuenta vigente; y `create_booking` rechaza con `tutor_not_payable`
  a los docentes que no pueden cobrar. **Ver «Ojo con la 0014» arriba.**
- `0015_email_outbox.sql`: **bandeja de salida de emails.** `email_outbox` (solo
  service role) y tres triggers anotan, en la misma transacción que el hecho,
  los avisos a enviar: reserva confirmada (al alumno) y nueva reserva (al
  docente), reserva cancelada (a las dos partes, con el reembolso que le
  corresponde al alumno) y reembolso realizado. Son idempotentes y nunca hacen
  fallar la operación que los dispara. `claim_pending_emails` los reclama con
  reintentos espaciados y `mark_email_result` anota el resultado (una fila
  enviada no vuelve atrás). El `payload` es una foto sin el email del
  destinatario, que se lee de `auth.users` recién al reclamar. Las reservas que
  vencen o se cancelan sin pago no generan emails.
- `0016_reviews.sql`: **calificación después de la clase y opiniones con autor.**
  `ratings` deja de ser pública: la leen solo el alumno y el docente de la
  clase y la administración (antes cualquiera veía todas sus columnas, incluido
  el id del alumno). Las opiniones públicas salen de `tutor_reviews`, que da
  solo el puntaje, el comentario, la fecha y el autor como nombre e inicial del
  apellido («Tomás R.»), de docentes aprobados. Se califica una clase
  completada propia, una vez, hasta 30 días después de que termina; la fecha la
  pone la base y el comentario se limpia (hasta 600 caracteres).
- `0017_class_attendance.sql`: **la clase se completa según la asistencia.**
  `record_class_attendance` (solo service role) recibe los segundos que el
  docente y el alumno estuvieron en la sala (los informa la app desde Daily) y
  decide: con el docente 10 minutos o más, la clase queda completada; si no,
  cerrada la sala, la reserva se cancela con reembolso del 100 %. La asistencia
  queda en `class_attendance` (la ven las partes y la administración; nadie la
  escribe desde la API). `sync_bookings` ya no completa las clases al terminar:
  solo las que pasaron 3 días sin asistencia registrada.
- `0018_reminder_and_tutor_decision_emails.sql`: **recordatorios de clase y
  decisión sobre el perfil.** `enqueue_class_reminders` (solo service role, la
  llama el mantenimiento de cada hora) anota un recordatorio 24 horas antes y
  otro 1 hora antes para el alumno y el docente, salvo que la clase se haya
  reservado con poca anticipación. Al aprobar o rechazar un perfil, un trigger
  anota el email al docente. `claim_pending_emails` descarta antes de reclamar
  los recordatorios de clases canceladas o que ya empezaron, y las decisiones
  sobre perfiles que después cambiaron.
- `0019_admin_audit_log.sql`: **registro de acciones y decisiones sobre los
  perfiles.** `audit_log` (la lee solo la administración; la escriben solo
  triggers y nadie la edita ni la borra, ni la service role) anota cada
  aprobación, rechazo, reapertura, baja, clase cancelada por la administración
  y cambio de rol. `decide_tutor_profile` es el camino de la app para decidir:
  valida la transición (reabrir: rechazado → pendiente; dar de baja: aprobado →
  rechazado) y exige motivo para rechazar o dar de baja. Un perfil rechazado
  siempre tiene motivo. Suma el email de reapertura y distingue una baja de un
  rechazo.
- `0020_admin_metrics.sql`: **métricas de la administración.** `admin_metrics`
  (exige administración) devuelve las cifras de los últimos 30 días y por
  semana: reservas pagas, clases dadas, ingresos, comisión neta de reembolsos,
  reembolsos, cancelaciones, ausencias del docente, reservas vencidas, docentes
  y alumnos activos y calificaciones.
- `0021_commission_tiers.sql`: **comisión por reputación, apagada.**
  `commission_settings` (interruptor, base 12 %, piso 6 %) y
  `commission_tiers` (los escalones de ejemplo), solo de la administración y
  con cada cambio en el registro. `commission_rate_for` pasa a leerlos:
  apagada devuelve la base; encendida, el escalón más bajo que el docente
  cumple, nunca menos que el piso. Cuentan las reseñas de clases completadas y
  pagas, una por alumno.
- `0022_site_content.sql`: **contenido editable del inicio.** `site_content`
  (una fila, legible por cualquiera, la cambia solo la administración y cada
  cambio queda en el registro): el texto del hero y la franja de anuncio, con
  límites de largo, hasta 3 renglones de título y enlaces solo a rutas del
  sitio o https.

Las migraciones 0006 a 0022 se probaron con unas 1.000 comprobaciones (la matriz de la RLS hace además 623 intentos por rol) y con 146 mutaciones (se rompe una regla a propósito y se comprueba que alguna prueba falle) en un Postgres real
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
  que hay que revisar a mano. Son 29 filas: las 1 a 19 y las 23 a 29 son comprobaciones de las migraciones (la 16
  es de la 0012, la 17 de la 0013, la 18 de la 0014, la 19 de la 0015, la 23 de la 0016, la 24 de la 0017, la 25
  de la 0018, la 26 de la 0019, la 27 de la 0020, la 28 de la 0021 y la 29 de la 0022) y
  tienen que decir OK; las 20 a 22
  son datos para revisar (reservas confirmadas sin pago, cuentas de administración y cuentas del seed de
  demo viejo) y pueden decir REVISAR (qué hacer con cada una: [docs/FASE-0-PASO-A-PASO.md](../docs/FASE-0-PASO-A-PASO.md), paso 4).

Las dos solo leen y se prueban en cada estado posible de la base (`supabase/tests/checks.db.mjs`).
