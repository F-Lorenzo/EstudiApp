# Fase 1 — Cobrar de verdad: diseño y plan de trabajo

Decisiones tomadas (8 de octubre de 2026):

| Tema | Decisión |
|---|---|
| Reembolsos | **100 %** si se cancela con **24 h o más** de anticipación · **50 %** entre **24 h y 2 h** · **0 %** con menos de 2 h. Si cancela el **docente** (o la administración), el alumno recibe **siempre el 100 %**. |
| Comisión | **12 %** de cada clase hoy. Más adelante baja según las referencias del docente (ver «Comisión por reputación»). |
| Emails | **Resend**. Hace falta un dominio propio verificado. |
| Mercado Pago | Marketplace con **Checkout Pro** (Split 1:1). El alumno paga en la página de Mercado Pago. Guía de cuenta: [MERCADO-PAGO-CUENTA.md](MERCADO-PAGO-CUENTA.md). |

## Cómo funciona Mercado Pago en este modelo (documentación oficial)

- Cada docente **vincula su cuenta por OAuth**; la plataforma guarda su `access_token` (dura **180 días**) y
  su `refresh_token` (dura **6 meses**). Hay que **renovarlos** antes de que venzan.
- La preferencia de pago se crea **con el token del docente** (`POST /checkout/preferences`) y lleva
  `marketplace_fee` con la comisión en pesos. La plata del docente va a su cuenta; la comisión, a la
  de la plataforma.
- Mercado Pago descuenta **primero su propia tarifa** de lo que recibe el docente; después, la comisión
  del marketplace del saldo restante. **La tarifa de Mercado Pago la absorbe el docente.**
- Los avisos (webhooks) llegan por `POST` con `type=payment` y `data.id`, firmados con HMAC SHA-256
  (`x-signature` con `ts` y `v1`, más `x-request-id`). Hay que responder **200/201 en menos de 22 s**;
  si no, reintentan con demoras crecientes (15 min, 30 min, 6 h, 48 h, 96 h).
- Tras el aviso se consulta el pago con `GET /v1/payments/{id}`: **el aviso nunca es la fuente de
  verdad, la consulta sí.**
- Reembolsos: `POST /v1/payments/{id}/refunds` con el header `X-Idempotency-Key`; sin cuerpo = total,
  con `{"amount": n}` = parcial. Hasta 180 días. En el modelo 1:1 el monto se descuenta del docente y de
  la plataforma **en forma proporcional**; si el docente no tiene saldo, la plataforma solo devuelve su parte.

**A verificar en la cuenta de prueba (la documentación no lo aclara del todo):** con qué token se crea
el reembolso (el del docente o el de la plataforma), qué pasa con la tarifa de Mercado Pago al
reembolsar, y si los medios de pago están limitados («solo dinero en cuenta entre cuentas de Mercado
Pago» aparece en la página de Split, y habría que confirmar que tarjetas funciona en este modelo). Esto
se prueba en el paso 1.5 antes de dar nada por cerrado.

## Principios de diseño

1. **La plata manda en Mercado Pago; el estado de la clase, en nuestra base.** Nunca se confirma una
   reserva por lo que diga el navegador del alumno ni por el cuerpo de un aviso: siempre se consulta el pago.
2. **Todo lo que mueve dinero pasa por funciones de la base con la `service_role`** y se prueba en
   `supabase/tests` (como `confirm_booking_payment` hoy). El código TypeScript orquesta; la regla vive en SQL.
3. **Idempotencia en cada borde:** avisos repetidos, el mismo pago dos veces, reembolsos reintentados
   (clave de idempotencia por reembolso) y el cobro y el aviso llegando en cualquier orden.
4. **Un pago que no se puede aceptar se devuelve solo.** Si `confirm_booking_payment` rechaza un pago
   aprobado (vencido, duplicado, monto distinto), se encola el reembolso total automáticamente.
5. **Los secretos nunca viajan al navegador ni a la tabla pública.** Los tokens de los docentes van
   en una tabla que solo lee la `service_role` y, además, cifrados por la app.
6. **Probar en sandbox antes de creer.** Lo que no se pueda probar con cuentas de prueba se marca como no
   verificado.

## Datos (migraciones nuevas, nunca editar las diez aplicadas)

| Migración | Contenido | Estado |
|---|---|---|
| `0011_payments_foundation` | `commission_rate_for(docente)` (12 %) y su **foto en cada reserva** (`bookings.commission_rate`); `confirm_booking_payment` valida la comisión contra esa foto; `refund_percent()` con la política; tabla `refunds` (cola de reembolsos con clave de idempotencia); `payments.refunded_amount`; `mark_refund_result()`; `mp_credentials` (tokens, solo `service_role`); `begin_payment_event()` / `finish_payment_event()` para avisos idempotentes | En construcción |
| `0012_cancel_with_refund` | `cancel_booking` deja de rechazar reservas pagas: calcula el reembolso según la política y lo encola. **Va junto con el ejecutor de reembolsos** (hasta que exista, una reserva paga no se puede cancelar: es la protección actual) | Después del ejecutor |
| `0013_require_payout_account` | `create_booking` exige que el docente tenga la cuenta de cobro vinculada | Con el OAuth |

## Flujos

**Pagar.** `create_booking` (retiene 15 min) → «Pagar con Mercado Pago» (acción del servidor) → se crea la
preferencia con el token del docente (`external_reference` = id de la reserva, `marketplace_fee`,
`expires` con el vencimiento de la retención, `notification_url`, `back_urls`) → el alumno paga en
Mercado Pago → vuelve a `/alumno/reservas/{id}` (pantalla «Estamos confirmando tu pago» que consulta el
estado, sin confiar en los parámetros de la URL) → llega el aviso → `confirm_booking_payment`.

**Aviso (webhook, `POST /api/mercadopago/webhook`).** Verificar firma → `begin_payment_event` (descarta
duplicados ya procesados) → buscar al docente por `user_id` → consultar el pago con su token →
según el estado: aprobado = confirmar (si falla, reembolso automático); rechazado = registrar (la reserva
sigue pendiente y puede reintentar dentro de los 15 min); reembolsado/contracargo = actualizar `payments`
→ `finish_payment_event`. Si algo falla por causas transitorias se responde 5xx para que Mercado Pago reintente.

**Cancelar y reembolsar** (migración 0012). `cancel_booking` calcula `refund_percent` (el docente y la
administración siempre 100 %), libera el horario si todavía es futuro y encola la fila de `refunds`; el
servidor ejecuta el reembolso en Mercado Pago con la clave de idempotencia y llama a
`mark_refund_result`. Un barrido reintenta los reembolsos pendientes o fallidos. La pantalla le dice
al alumno **antes de confirmar** cuánto recibe.

**Vincular al docente (OAuth).** Botón en «Cuenta de cobro» → `auth.mercadopago.com.ar/authorization`
con `state` aleatorio guardado en una cookie firmada → `GET /api/mercadopago/oauth/callback` →
canje del `code` por tokens → se guardan cifrados en `mp_credentials` y el `user_id` en
`tutor_private.mercadopago_account_id`. Un barrido renueva los tokens que vencen en menos de 30 días.

## Comisión por reputación (diseño, para implementar después de la Fase 2)

Idea: **cuanto mejores referencias tiene el docente, menos comisión paga.**

- **Hoy (Fase 1):** `commission_rate_for(docente)` devuelve 12 % para todos y cada reserva guarda su tasa
  (`commission_rate`). Cambiar la regla más adelante **no toca las reservas ya hechas** ni el código de cobro.
- **Después (necesita el formulario real de calificaciones de la Fase 2):** tabla `commission_tiers`
  (`min_reviews`, `min_rating`, `rate`, activa) administrable desde el panel. La función elige la
  tasa más baja para la que el docente califica.
- **Escalones de ejemplo, a definir con el cliente:**

  | Referencias | Calificación mínima | Comisión |
  |---|---|---|
  | menos de 10 | — | 12 % |
  | 10 o más | 4,5 | 10 % |
  | 25 o más | 4,7 | 8 % |
  | 50 o más | 4,8 | 6 % |

- **Reglas contra abusos:** cuentan solo reseñas de clases **completadas y pagas**; mínimo de reseñas
  para evitar que una sola de 5 estrellas baje la comisión; solo de alumnos distintos; la administración
  puede excluir reseñas fraudulentas; el piso nunca baja de lo que cubre el costo del servicio.
- **Estabilidad:** la tasa se recalcula al llegar una calificación (no en cada reserva) y se guarda en la
  reserva al crearla. El docente ve en su panel su escalón actual y qué le falta para el siguiente.
- **Decisiones del cliente:** los escalones, el mínimo de reseñas, y si el descuento se comunica a los docentes.

## Plan de trabajo (en orden)

| # | Trabajo | Necesita |
|---|---|---|
| 1.1 | Migración `0011` + pruebas + matriz de RLS | Nada |
| 1.2 | Cliente de Mercado Pago tipado (preferencias, pagos, reembolsos, OAuth) con clave de idempotencia y reintentos; verificación de firma del aviso; interfaz de proveedor con una versión simulada para pruebas | Nada |
| 1.3 | Ruta del webhook y su procesamiento, probados con el proveedor simulado (pago aprobado, rechazado, duplicado, tardío, fuera de orden, firma inválida, reintentos) | Nada |
| 1.4 | Vinculación del docente (OAuth), cifrado de tokens, renovación, `0013` | Aplicación de Mercado Pago creada (paso 1 a 5 de la guía) |
| 1.5 | «Pagar con Mercado Pago» y pantalla de retorno; **prueba de punta a punta en sandbox** (comprador y vendedor de prueba) y verificación de los puntos abiertos de arriba | Claves de prueba cargadas, webhook configurado |
| 1.6 | Cancelación con reembolso (`0012`), ejecutor y barrido de reembolsos; textos de la política en la pantalla y en `/cancelacion` | Sandbox |
| 1.7 | Emails con Resend: reserva confirmada, nueva reserva al docente, pago recibido | Dominio verificado y API key |
| 1.8 | Revisión adversarial del dinero, retiro del pago simulado fuera de desarrollo, pruebas de pagos duplicados/tardíos/rechazados, cierre de la fase | Todo lo anterior |

**Criterio de salida de la fase** (de [ROADMAP.md](../ROADMAP.md)): con cuentas de prueba, una reserva se
paga, la confirma el webhook, el docente queda acreditado con la comisión descontada y una cancelación
dentro del plazo devuelve el dinero; probado además con pagos duplicados, tardíos y rechazados.

## Qué necesito de vos

1. **Crear la cuenta de Mercado Pago y la aplicación** siguiendo [MERCADO-PAGO-CUENTA.md](MERCADO-PAGO-CUENTA.md)
   (lo único con demora propia: la verificación de identidad).
2. **Un dominio propio** para Resend (los emails desde `@tu-dominio` no caen en spam).
3. Más adelante: los escalones de comisión por reputación y el texto legal definitivo de cancelación.
