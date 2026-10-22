# Fase 1 — Cobrar de verdad: diseño y plan de trabajo

Decisiones tomadas (8 de octubre de 2026):

| Tema | Decisión |
|---|---|
| Reembolsos | **100 %** si se cancela con **24 h o más** de anticipación · **50 %** entre **24 h y 2 h** · **0 %** con menos de 2 h. Si cancela el **docente** (o la administración), el alumno recibe **siempre el 100 %**. |
| Comisión | **12 %** de cada clase hoy. Más adelante baja según las referencias del docente (ver «Comisión por reputación»). |
| Emails | **Resend**. Hace falta un dominio propio verificado. |
| Mercado Pago | Marketplace con **Checkout API** (Split 1:1, formulario de tarjeta de Mercado Pago dentro de EstudiApp). Hasta el 22 de octubre de 2026 era Checkout Pro; se cambió porque el checkout de Mercado Pago fallaba en todas las pruebas. Guía de cuenta: [MERCADO-PAGO-CUENTA.md](MERCADO-PAGO-CUENTA.md). |

## Cómo funciona Mercado Pago en este modelo (documentación oficial)

- Cada docente **vincula su cuenta por OAuth**; la plataforma guarda su `access_token` (dura **180 días**) y
  su `refresh_token` (dura **6 meses**). Hay que **renovarlos** antes de que venzan.
- La tarjeta se tokeniza en el navegador con la **clave pública del docente** (Card Payment Brick) y el pago se
  crea **con el token del docente** (`POST /v1/payments`, con `X-Idempotency-Key` y `binary_mode`). Lleva
  `application_fee` con la comisión en pesos. La plata del docente va a su cuenta; la comisión, a la de la
  plataforma.
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
| `0011_payments_foundation` | `commission_rate_for(docente)` (12 %) y su **foto en cada reserva** (`bookings.commission_rate`); `confirm_booking_payment` valida la comisión contra esa foto; `refund_percent()` con la política; tabla `refunds` (cola de reembolsos con clave de idempotencia); `payments.refunded_amount`; `mark_refund_result()`; `mp_credentials` (tokens, solo `service_role`); `begin_payment_event()` / `finish_payment_event()` para avisos idempotentes | ✅ Aplicada y verificada en el proyecto real |
| `0012_payment_notifications` | `apply_payment_notification()`: **la base decide qué hacer con cada pago** que informa Mercado Pago (confirmar, reembolsar el 100 % lo que no se puede aceptar, dejar para revisar lo raro, no hacer nada ante repeticiones o avisos fuera de orden). `enqueue_refund()`: encola un reembolso una sola vez por pago (la usará también la cancelación). Solo `service_role` | ✅ Escrita y probada (73 comprobaciones + mutaciones). **Sin aplicar en el proyecto real:** hace falta recién para el paso 1.5 |
| `0013_cancel_with_refund` | `cancel_booking` deja de rechazar reservas pagas: calcula el reembolso según la política (alumno 100/50/0 %, docente y administración siempre 100 %), lo encola con `enqueue_refund` y devuelve el resultado; `retryable_refunds()` para el barrido; `refunds.mp_user_id` (de qué cuenta se devuelve) | ✅ Escrita y probada (147 comprobaciones + mutaciones). **Sin aplicar en el proyecto real** |
| `0014_payout_accounts` | `save_mp_credentials`, `rotate_mp_tokens`, `unlink_my_mp_account`, `tutor_can_receive_payments`; **`create_booking` exige que el docente tenga la cuenta de cobro vigente** (`tutor_not_payable`). Al aplicarla, ningún docente es reservable hasta que vincule su cuenta | ✅ Escrita y probada (179 comprobaciones + mutaciones). **Sin aplicar en el proyecto real** |
| `0015_email_outbox` | Bandeja de emails (`email_outbox`) con triggers (reserva confirmada, nueva reserva al docente, cancelación, reembolso), `claim_pending_emails`, `mark_email_result`. Solo `service_role` | ✅ Escrita y probada (127 comprobaciones + mutaciones). **Sin aplicar en el proyecto real** |

## Flujos

**Pagar.** `create_booking` (retiene 15 min) → «Pagar con tarjeta» → `preparePayment` (acción del servidor:
comprueba la reserva y devuelve la clave pública del docente y el monto de la base) → el formulario de
Mercado Pago tokeniza la tarjeta en el navegador → `payWithCard` (vuelve a comprobar la reserva y crea el
pago con el token del docente: `external_reference` = id de la reserva, `application_fee`, `binary_mode`,
`notification_url`) → el pago se le pasa a la base en el momento (`applyProviderPayment`, el mismo camino
que el aviso) → la pantalla muestra el estado real; si sigue pendiente, «Estamos confirmando tu pago»
consulta hasta que llegue el aviso. El código está en `src/lib/payments/checkout.ts`.

**Aviso (webhook, `POST /api/mercadopago/webhook`).** Verificar firma (si falta la clave o la firma no
cierra, no se hace nada) → `begin_payment_event` (descarta duplicados ya procesados) → buscar el token
del docente por el `user_id` del aviso → **consultar el pago con ese token** (el aviso solo es una pista)
→ `apply_payment_notification` (la base decide, en una transacción) → `finish_payment_event`.

La base responde una de estas cosas, y el servidor hace lo que corresponde:

| Resultado | Qué pasó | Qué hace el servidor |
|---|---|---|
| `confirmada` / `ya_confirmada` | Pago aprobado y aceptable; o el mismo pago otra vez / un aviso viejo fuera de orden | Nada más. 200 |
| `pendiente` / `rechazada` | Todavía no se acreditó, o se rechazó | Nada: la reserva sigue pendiente y el alumno puede reintentar dentro de los 15 min. 200 |
| `reembolso_encolado` / `reembolso_existente` | Pago aprobado que **no se puede aceptar** (retención vencida, reserva cancelada, segundo pago de la misma reserva, monto o moneda distintos, clase empezada, reserva inexistente) | Ejecuta el reembolso total en Mercado Pago con la clave de idempotencia de la fila y anota el resultado. Si falla de forma pasajera: 500 (Mercado Pago reintenta) |
| `reembolso_confirmado` | Un reembolso nuestro había quedado con resultado incierto y el aviso muestra que Mercado Pago ya devolvió el monto | Nada más (se da por hecho) |
| `requiere_revision` | Cuenta de cobro desconocida o distinta a la del docente de la reserva, reembolso o contracargo hecho por fuera de la app, monto inválido, estado desconocido | **No toca plata.** Queda anotado en `payment_webhook_events.process_error` (con `processed_at` vacío). 200 |
| error de la base o de Mercado Pago | Falla pasajera | 500: Mercado Pago reintenta a los 15 min, 30 min, 6 h, 48 h y 96 h |

Cada entrega distinta (otra acción, otra marca de tiempo) es un evento distinto: nunca se descarta un
aviso nuevo por parecerse a uno anterior. Repetir uno cerrado no hace nada.

**Cancelar y reembolsar** (migración 0013). `cancel_booking` calcula `refund_percent` (el docente y la
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
| 1.1 ✅ | Migración `0011` + pruebas + matriz de RLS | Nada |
| 1.2 ✅ | Cliente de Mercado Pago tipado (preferencias, pagos, reembolsos, OAuth) con clave de idempotencia y reintentos; verificación de firma del aviso; cifrado de tokens (AES-GCM); interfaz de proveedor con una versión simulada para pruebas. En `src/lib/payments` | Nada |
| 1.3 ✅ | Ruta del webhook y su procesamiento + migración `0012`, probados con el proveedor simulado y un Postgres real (pago aprobado, rechazado, duplicado, tardío, fuera de orden, firma inválida, reintentos, cuenta distinta, reembolso con falla pasajera) | Nada |
| 1.4 ✅ código | Vinculación del docente por OAuth (`/api/mercadopago/oauth/start` y `callback`, estado firmado en cookie, tokens cifrados), renovación de tokens, tarjeta «Cuenta de cobro» en el panel docente, `0014`. Probado con Mercado Pago simulado | Para probarlo de verdad: claves cargadas en Vercel |
| 1.5 ◐ código | «Pagar con tarjeta» por Checkout API (`preparePayment` y `payWithCard`), pantalla de confirmación, reconciliación por referencia externa; **falta**: aplicar 0012-0015, cargar claves, configurar el webhook y la **prueba de punta a punta en sandbox** (comprador y vendedor de prueba) con los puntos abiertos de abajo | Claves de prueba cargadas, webhook configurado, dominio conectado |
| 1.6 ✅ código | Cancelación con reembolso (`0013`) para el alumno y para el docente, ejecutor, barrido, política en pantalla y en `/cancelacion`. Probado con Mercado Pago simulado | Sandbox para verificar |
| 1.7 ✅ código | Emails con Resend desde la bandeja de la base (se envían después de responder y en el mantenimiento diario). Reserva confirmada (incluye el recibo), nueva reserva al docente, cancelación y reembolso | Dominio verificado y API key de Resend |
| 1.8 ◐ | Pago simulado retirado de previews y producción (solo `next dev`). Mantenimiento diario (`/api/cron/payments-maintenance`, ver `vercel.json`). **Falta la revisión adversarial** de todo lo nuevo y pruebas unitarias propias de `checkout.ts`, `reconcile.ts`, `refund-sweep.ts`, `cancellation.ts` y la acción del docente (hoy se prueban solo de forma indirecta) | Todo lo anterior |

**Criterio de salida de la fase** (de [ROADMAP.md](../ROADMAP.md)): con cuentas de prueba, una reserva se
paga, la confirma el webhook, el docente queda acreditado con la comisión descontada y una cancelación
dentro del plazo devuelve el dinero; probado además con pagos duplicados, tardíos y rechazados.

## Qué está probado y qué no (al terminar los pasos 1.2 y 1.3)

**Probado** (275 pruebas unitarias, 11 suites de base de datos, mutaciones sobre la `0012`):

- Las reglas del dinero en un Postgres real: cada resultado de `apply_payment_notification`, idempotencia, que un
  error inesperado no se confunda con «pago no aceptable», permisos (solo `service_role`).
- El recorrido completo del aviso (firma → registro → consulta → base → reembolso → cierre) contra un
  proveedor **simulado** y la base real, incluidos reintentos, fallas pasajeras y avisos repetidos o desordenados.
- El cliente de Mercado Pago contra respuestas **escritas a mano** según la documentación: formato de los
  pedidos, reintentos, que el OAuth nunca reintente solo, que ningún error muestre un token.
- La firma, contra valores calculados aparte con `openssl`.

**No probado contra Mercado Pago real** (se verifica en el paso 1.5 con la cuenta de prueba):

- Que los pedidos y respuestas reales coincidan con lo que dice la documentación (campos, `collector_id`, `application_fee`
  con el token de un vendedor vinculado por OAuth, el aviso trayendo `user_id`).
- Que la firma real coincida con el formato documentado, y si los reintentos de un mismo aviso conservan la marca de tiempo.
- Con qué token se hace el reembolso (el código usa el del docente), qué pasa con la tarifa de Mercado Pago al reembolsar, y
  si «tarjeta» funciona en el modelo marketplace.

## Puntos abiertos (decisiones o mejoras detectadas al construir)

1. **Pago a tiempo con aviso tardío.** Hoy `confirm_booking_payment` compara contra la hora en que **llega** el aviso: si el alumno paga
   al minuto 14 y el aviso llega al minuto 16, el pago se reembolsa solo aunque haya sido a tiempo. Es seguro (nunca se queda con plata
   sin dar la clase) pero molesto. Propuesta: aceptar si la fecha de aprobación del pago cae dentro de los 15 minutos y el horario
   sigue siendo de esa reserva. Requiere una migración y es una decisión de producto.
2. **Reembolsos y contracargos hechos por fuera de la app** (el docente reembolsa desde Mercado Pago, o el alumno desconoce el cobro):
   hoy solo quedan marcados «requiere revisión»; no se actualiza el pago ni la reserva. Falta definir qué pasa con la clase.
3. **Pago rechazado visible para el alumno.** La base no guarda los intentos rechazados; la pantalla de retorno (1.5) podrá consultar el estado
   directamente a Mercado Pago para decirle «tu pago fue rechazado, probá con otro medio».
4. **Un reembolso por pago.** `refunds.mercadopago_payment_id` es único: por política hay un solo reembolso por pago. Si alguna vez hiciera falta
   uno parcial y después otro, hay que cambiar esa restricción.
5. **Token de reembolso.** Si Mercado Pago exige el token de la plataforma en vez del del docente, solo cambia qué token recibe
   `executeRefund`; hay que dejar guardado el de la plataforma en una variable de entorno.

## Qué necesito de vos

1. **Crear la cuenta de Mercado Pago y la aplicación** siguiendo [MERCADO-PAGO-CUENTA.md](MERCADO-PAGO-CUENTA.md)
   (lo único con demora propia: la verificación de identidad).
2. **Un dominio propio** para Resend (los emails desde `@tu-dominio` no caen en spam).
3. Más adelante: los escalones de comisión por reputación y el texto legal definitivo de cancelación.
