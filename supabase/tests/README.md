# Pruebas de la base de datos

Aplican las migraciones **reales** (`../migrations`) sobre un Postgres en memoria (PGlite) con lo
mínimo de Supabase (esquema `auth`, roles `anon`, `authenticated` y `service_role`) y comprueban,
rol por rol, qué se puede y qué no. No tocan ningún proyecto de Supabase.

```bash
npm run test:db              # todas
npm run test:db -- bookings  # solo las que tengan «bookings» en el nombre
```

| Archivo | Qué cubre |
|---|---|
| `rls-base.db.mjs` | Roles, ascenso a administrador, aprobación de docentes, disponibilidad, visibilidad, calificaciones |
| `bookings.db.mjs` | Reservas: crear, retener, vencer, cancelar y confirmar el pago; permisos de las funciones |
| `hardening.db.mjs` | Un caso por cada hallazgo de las revisiones de seguridad (perfiles de docente, pagos tardíos, tope de reservas, visibilidad) |
| `private-data.db.mjs` | Datos privados del docente (`tutor_private`) |
| `rls-matrix.db.mjs` | **Auditoría completa de la RLS**: 84 pruebas × 7 roles (visitante, alumno, otro alumno, docente, otro docente, administración, service role) sobre todas las tablas y operaciones (incluida la bandeja de emails), más «RLS activada en cada tabla», quién puede ejecutar cada función y que **toda función expuesta a la API esté declarada** en la matriz (si una migración nueva se olvida de un `revoke`, la matriz lo marca) |
| `upgrade-path.db.mjs` | Actualización de un proyecto **con datos**: aplica 0006 a 0015 sobre una base con las migraciones 0001 a 0005 y comprueba que no se pierde nada (que ningún docente existente cobra hasta vincular su cuenta, que un pago viejo sin identificador de Mercado Pago no se reembolsa solo...), que el archivo único (`npm run db:bundle`) se aplica de una vez y que, si falla, no queda nada a medias |
| `seed-compat.db.mjs` | Que las escrituras de `scripts/seed-demo.mjs` sigan siendo válidas con el esquema actual (cuentas de cobro de relleno y pagos «simulado-…» incluidos) |
| `fresh-install.db.mjs` | Instalación desde cero: el archivo único `npm run db:bundle -- 1 <última>` (completo y compacto) sobre una base vacía deja un esquema IDÉNTICO (773 elementos comparados) al de todas las migraciones una por una, y la app anda encima. También los tramos finales (`12 15`, `13 15`, `14 15`, `15 15`) sobre una base que ya tiene las anteriores y datos |
| `payments.db.mjs` | Cimientos del cobro (0011): política de reembolsos con la tabla de casos límite compartida con TypeScript, comisión y su foto en cada reserva, confirmación de pago, cola de reembolsos, avisos idempotentes y credenciales de Mercado Pago |
| `payment-notifications.db.mjs` | Avisos de pago (0012): cada resultado de `apply_payment_notification` (aprobado, pendiente, rechazado, tardío, duplicado, monto o moneda distintos, cuenta de cobro equivocada, reembolsos externos), idempotencia, curación de un reembolso de resultado incierto, que un error inesperado no se confunda con «pago no aceptable» y los permisos. Se le hicieron mutaciones para comprobar que las pruebas detectan cada regla rota |
| `cancel-refund.db.mjs` | Cancelar con reembolso (0013): la matriz completa de la política con la MISMA tabla de casos que SQL y TypeScript (3 días, 24 h exactas, 23 h 59, 12 h, 2 h exactas, 1 h 59, 30 min; el docente y la administración siempre 100 %; clase empezada), con el reloj de la transacción fijo para probar los límites exactos; reserva sin pago, reserva ajena, dos cancelaciones seguidas, pago sin identificador, pago simulado; que el monto sea exacto con precios con centavos y coincida con `refundAmount` de TypeScript; que el reembolso aprobado actualice el pago; `enqueue_refund` y `apply_payment_notification` con la cuenta de cobro; `retryable_refunds` (estados, intentos, antigüedad, cuenta, orden, límite, permisos) |
| `payout-accounts.db.mjs` | Cuentas de cobro (0014): `save_mp_credentials` (feliz, upsert, cuenta de otro docente, no es docente, tokens vacíos o vencidos, atomicidad), `rotate_mp_tokens`, `unlink_my_mp_account` y los impedimentos (reservas por dar, reembolsos sin cerrar) también al cambiar de cuenta, `tutor_can_receive_payments`, `create_booking` con docentes sin cuenta o con cuenta vencida (y el orden de los controles), y que los tokens no se puedan leer ni escribir desde ningún rol de la API |
| `email-outbox.db.mjs` | Bandeja de emails (0015): cada trigger (confirmación, cancelación de una reserva paga con su reembolso, reembolso aprobado), idempotencia, que cancelar o vencer una reserva sin pago no genere emails, que un problema con el email nunca rompa la operación principal, `claim_pending_emails` (límite, reintentos espaciados, tope de intentos, omitir a quien no tiene email), `mark_email_result` (una fila enviada no vuelve atrás, estado inválido, el detalle sin direcciones de email), que la bandeja y sus funciones sean solo del backend y que ningún payload lleve un email |
| `reminders.db.mjs` | Recordatorios y decisión sobre el perfil (0018): las ventanas de 24 horas y 1 hora, las dos partes, sin duplicar, sin recordatorio pegado al email de la reserva, el descarte al reclamar de los recordatorios de clases canceladas o empezadas y de las decisiones que cambiaron, que el email nunca haga fallar la decisión y los permisos |
| `audit-log.db.mjs` | Registro de acciones y decisiones sobre perfiles (0019): cada acción de `decide_tutor_profile` con sus transiciones y motivos, que todo cambio de estado quede registrado (también el docente que reenvía y los cambios sin sesión), las cancelaciones y los cambios de rol de la administración, que el registro no se edite ni se borre (ni con la service role), quién lo lee y los emails de reapertura y baja |
| `metrics.db.mjs` | Métricas (0020): que solo la administración las vea y que cada cifra cuente lo que dice (pagos cobrados, también los devueltos enteros; comisión neta de reembolsos; cancelaciones, ausencias y reservas vencidas; activos; calificaciones; semanas de lunes a domingo) |
| `commission.db.mjs` | Comisión por reputación (0021): apagada todos pagan la base; encendida, el escalón más bajo que se cumple sin bajar del piso; qué reseñas cuentan (completadas y pagas, una por alumno); la reserva guarda la tasa del momento; solo la administración lee y edita, y cada cambio queda en el registro |
| `site-content.db.mjs` | Contenido del inicio (0022): lo lee cualquiera y lo cambia solo la administración; límites del hero (renglones, largos); el anuncio necesita texto; enlaces solo a rutas del sitio o https (nada de `javascript:` ni `//`); cada cambio queda en el registro y guardar sin cambios no agrega nada |
| `email-expiry.db.mjs` | Emails vencidos y resumen de la bandeja (0023): vence lo que lleva 48 horas sin salir (no lo reciente, lo enviado ni lo que agotó los intentos) y no se reclama; el resumen cuenta por estado, muestra los últimos problemas sin destinatarios ni contenido y lo ve solo la administración |
| `abuse-limits.db.mjs` | Límites contra el abuso (0024): 5 intentos de pago con tarjeta por reserva y 10 por alumno en 24 horas (el rechazado no se anota, el tope por reserva no vence, otro alumno no se ve afectado), 10 reservas sin pagar vencidas o canceladas por día (las pagas y las de ayer no cuentan) y que todo sea solo del backend |
| `catalog-search.db.mjs` | Búsqueda del catálogo (0025): sin tildes ni mayúsculas, palabras en cualquier orden, sin comodines, solo los primeros 100 caracteres; filtros de materia, precio y horarios (= reservable: no la próxima hora ni un docente sin cuenta de cobro vigente); los dos órdenes con desempate; páginas que juntas son el catálogo entero, con el total y el tope de 48; y que cada rol vea solo a los aprobados y sus datos públicos |
| `storage-uploads.db.mjs` | Fotos y respaldos en Storage (0026): la configuración de las dos carpetas (pública y privada, tamaños y tipos); que cada cuenta suba, liste, mueva y borre solo en su subcarpeta (y en un solo nivel); que el respaldo lo suba solo un docente y lo lean solo él y la administración. El arnés trae una copia mínima del esquema `storage` de Supabase |
| `checks.db.mjs` | Que las consultas de `supabase/checks` (diagnóstico y verificación para el SQL Editor) funcionen en cualquier estado de la base y digan lo correcto (cada una de las filas, con las migraciones hasta cada punto, y que marquen FALLA si una función queda con permisos de más) |

Los ayudantes `seed.mjs` (datos base; el docente base ya tiene una cuenta de cobro de relleno vigente) y
`booking-helpers.mjs` (armar una reserva paga y cancelarla con la clase empezando a una distancia exacta) no son
suites: el corredor solo ejecuta los archivos `*.db.mjs`. Si una suite se corta con una excepción, `track()` (en
`harness.mjs`) imprime lo que alcanzó a comprobar y el motivo.

### La matriz de la RLS

Cada prueba de `rls-matrix.db.mjs` declara **quién puede** hacer algo; todos los demás tienen que quedar
afuera. Para comprobar que la matriz detecta un permiso abierto, se puede sabotear la base a propósito
(tiene que terminar con fallas):

```bash
MATRIX_SABOTAJE="create policy x on public.payments for select using (true);" npm run test:db -- matrix
```

Cuando una migración cambia un permiso a propósito, se actualiza la expectativa de la matriz en el mismo
cambio: así la regla queda escrita.

### Mutaciones

Una regla que se puede romper sin que ninguna prueba falle no está probada. `mutations.mjs` rompe a propósito
**184 reglas** de las migraciones 0013 a 0026 (y de la política de reembolsos de la 0011) y comprueba que alguna
suite falle: un umbral de 24 h o 2 h, el porcentaje del tramo parcial, el redondeo del monto, un `for update`, la
cuenta de cobro que se guarda en el reembolso, un permiso abierto a `authenticated`, la restricción única de la
bandeja de emails, el payload con el email adentro, el reintento sin espera, una fila enviada que vuelve atrás, etc.

```bash
node supabase/tests/mutations.mjs          # todas (unos 10 minutos)
node supabase/tests/mutations.mjs 14-      # solo las de la 0014
```

Cada mutación se hace sobre una **copia** de las migraciones (`ESTUDIAPP_MIGRATIONS_DIR`, que lee `harness.mjs`):
los archivos reales nunca se tocan. Si una mutación sobrevive, o el texto de la migración cambió y ya no se aplica,
el comando termina con error. La carrera real entre dos cancelaciones simultáneas no se puede reproducir con una sola
conexión (PGlite): el `for update` de `cancel_booking` y los candados de la cuenta de cobro se comprueban mirando
el código de la función.

## Cómo agregar una prueba

1. Crear la base con `makeDb({ upTo: N })` y cargar los datos con `seed(db)` (`seed.mjs`).
2. Ejecutar las consultas con `as(db, "alumno" | "docente" | "admin" | "anon" | "service", fn)`: corren
   con el rol y el usuario de esa clave, así que la RLS aplica de verdad.
3. Comprobar con `expectOk`, `expectFail` o empujando `[ok, mensaje]` en la lista de resultados (conviene
   crearla con `const r = track([])`, así una excepción no pierde el informe), y terminar con `report(resultados)`.
4. Si la regla es de la 0013 a la 0015, agregar su mutación a `mutations.mjs`.

Toda regla que mueve dinero o protege datos tiene que tener acá un caso que la rompa a propósito.
Las pruebas no reemplazan probar las migraciones en un proyecto de Supabase de prueba antes de
aplicarlas en el real.
