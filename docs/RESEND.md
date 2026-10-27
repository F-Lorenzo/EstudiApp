# Configurar Resend (emails de EstudiApp)

Guía para encender el envío de emails. El código ya está listo y probado contra un Resend simulado. La cuenta
está creada y el dominio `estudiapp.app` quedó **verificado el 27 de octubre de 2026**; faltan las variables en
Cloudflare y la prueba.

**Decisiones del 26 de octubre de 2026:**

- Los emails salen de `EstudiApp <avisos@estudiapp.app>` (decisión del 27 de octubre de 2026, en lugar del
  subdominio `mail.estudiapp.app` que se había elegido el 26): el dominio verificado en Resend es el principal y el
  plan gratuito admite un solo dominio. Si algún día los avisos tienen problemas de entrega y conviene separar su
  reputación, se agrega `mail.estudiapp.app` como dominio en Resend y se cambia `EMAIL_FROM`.
- Las respuestas van a **una casilla de soporte** que alguien lea (`EMAIL_REPLY_TO`).
- **Un email que no sale en 48 horas vence** y no se manda (migración 0023). Así, al encender Resend no salen
  los avisos de las pruebas acumulados en la bandeja.

## Antes de empezar

1. ✅ **Migración 0023 aplicada** (26 de octubre de 2026). Tiene que estar antes de cargar la clave: así los
   emails viejos de prueba vencen y no salen. En un proyecto nuevo: `npm run db:bundle -- 23 23`, pegar
   `supabase/aplicar-0023-a-0023.sql` en el SQL Editor y comprobar que la fila 30 de
   `supabase/checks/2-verificacion.sql` diga OK.
2. Tené a mano la casilla de soporte (por ejemplo `soporte@estudiapp.app`). Tiene que existir y recibir correo:
   `estudiapp.app` no tiene MX, así que una dirección `@estudiapp.app` no recibe nada hasta que la configures.
   Lo más simple es **Cloudflare → estudiapp.app → Email → Email Routing**: creás `soporte@estudiapp.app` y la
   reenviás a una casilla que alguien lea. Probala mandándole un email antes de cargarla en `EMAIL_REPLY_TO`.

## 1. Crear la cuenta y agregar el dominio

1. Creá la cuenta en [resend.com](https://resend.com) con el email del proyecto.
2. **Domains → Add Domain** y escribí `estudiapp.app`.
3. En **Region** elegí **São Paulo (sa-east-1)**, que es la más cercana a Argentina. La región queda fija para
   ese dominio: si te equivocás, hay que borrarlo y agregarlo de nuevo.
4. Resend muestra los registros DNS que hay que crear: los de **SPF** bajo `send` y un **TXT (DKIM)** bajo
   `resend._domainkey`.

## 2. Cargar los registros en Cloudflare

El dominio `estudiapp.app` está en Cloudflare, así que hay dos caminos:

- **Automático (recomendado):** en la pantalla del dominio en Resend, el botón **Sign in to Cloudflare** crea
  los registros solo, después de que autorizás el acceso.
- **A mano:** en Cloudflare, **estudiapp.app → DNS → Records → Add record**, uno por cada registro que muestra
  Resend. En «Name» va solo la parte del subdominio (`send.mail`, `resend._domainkey.mail`), no el dominio
  completo. Un MX va con prioridad 10. Si algún registro es CNAME, tiene que quedar con la **nube gris («DNS
  only»)**: con la nube naranja la verificación no termina.

Estos registros van en `send.estudiapp.app` y `resend._domainkey.estudiapp.app`: no cambian cómo recibe correo
`estudiapp.app`.

**Si el DKIM no verifica («no TXT record found at resend._domainkey…»):** buscá en Cloudflare registros NS con
nombre `_domainkey`. Un NS delega todo lo que está debajo a otros servidores y tapa el TXT de Resend (Cloudflare lo
marca como «Records shadowing»). Así pasó el 27 de octubre de 2026: había dos NS de Namecheap
(`verify-contact-details` y `failed-whois-verification`), restos de cuando el dominio se pasó a Cloudflare. Se
borraron y verificó.

**Recomendado: DMARC.** Si `estudiapp.app` todavía no tiene un registro `_dmarc`, agregá un TXT con nombre
`_dmarc` y valor `v=DMARC1; p=none;`. Gmail y Yahoo lo piden a quien manda volumen, y ayuda a no caer en spam.

Volvé a Resend y apretá **Verify DNS Records**. Suele tardar unos minutos. El dominio tiene que quedar
**Verified**.

**En la configuración del dominio, dejá apagados «Click tracking» y «Open tracking».** El seguimiento de clics
cambia los enlaces de los emails por enlaces de Resend, y el de aperturas agrega una imagen invisible. Los
avisos de EstudiApp no los necesitan.

## 3. Crear la clave

1. **API Keys → Create API Key**.
2. Nombre: `estudiapp-produccion`. Permiso: **Sending access**. Dominio: `estudiapp.app`.
3. Copiá la clave (empieza con `re_`). Resend la muestra una sola vez. **No la pegues en el chat, en Git ni en
   un documento.**

## 4. Cargar las variables en Cloudflare

En **Workers & Pages → estudiapp → Settings → Variables and Secrets → Production**:

| Nombre | Tipo | Valor |
| --- | --- | --- |
| `RESEND_API_KEY` | **Secret** | la clave `re_...` |
| `EMAIL_FROM` | Text | `EstudiApp <avisos@estudiapp.app>` |
| `EMAIL_REPLY_TO` | Text | la casilla de soporte, por ejemplo `soporte@estudiapp.app` |

Guardá con **Deploy**. `wrangler.jsonc` tiene `keep_vars: true`, así que los próximos despliegues conservan
estas variables.

## 5. Probar

1. Entrá a **`/admin/emails`** con la cuenta de administración. Las cinco filas de «Configuración» tienen que
   decir **OK** y arriba tiene que decir **Enviando**.
2. Apretá **Enviarme un email de prueba**. Llega al email de tu cuenta de administración. Fijate:
   - que llegue a la bandeja de entrada y no a spam;
   - que el remitente diga «EstudiApp»;
   - que al responder, la respuesta vaya a la casilla de soporte.
3. Si falla, la pantalla dice por qué: un 401 es la clave, un 403 es el dominio sin verificar o un `EMAIL_FROM`
   que no es de `estudiapp.app`.
4. A partir de ahí, los avisos reales salen solos: después de cada reserva, cancelación o decisión sobre un
   perfil, y en el mantenimiento de cada hora. En `/admin/emails` se ve cuántos salieron, cuántos esperan y los
   últimos problemas.

## Límites del plan gratuito

Al 26 de octubre de 2026, el plan gratuito de Resend permite unos 3.000 emails por mes y 100 por día, con un
solo dominio. Cada reserva genera hasta 6 emails (la confirmación al alumno y al docente, y dos recordatorios
a cada uno). Con más de unas 15 reservas por día conviene pasar a un plan pago. Confirmá los números actuales
en resend.com/pricing antes del lanzamiento.

## Qué falta comprobar con la cuenta real

Lo marcado en `src/lib/email/resend.ts`: el formato exacto de los errores de Resend, que la cabecera
`Idempotency-Key` evite duplicados durante 24 horas y el límite de pedidos por segundo. El email de prueba y
los primeros avisos reales lo confirman.
