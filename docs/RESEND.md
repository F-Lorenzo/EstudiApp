# Configurar Resend (emails de EstudiApp)

Guía para encender el envío de emails. El código ya está listo y probado contra un Resend simulado. Faltan la
cuenta, el dominio y tres variables en Cloudflare.

**Decisiones del 26 de octubre de 2026:**

- Los emails salen de un **subdominio**: `EstudiApp <avisos@mail.estudiapp.app>`. Resend lo recomienda porque
  así un problema de entrega no afecta al correo del dominio principal.
- Las respuestas van a **una casilla de soporte** que alguien lea (`EMAIL_REPLY_TO`).
- **Un email que no sale en 48 horas vence** y no se manda (migración 0023). Así, al encender Resend no salen
  los avisos de las pruebas acumulados en la bandeja.

## Antes de empezar

1. **Aplicá la migración 0023** (`npm run db:bundle -- 23 23` y pegá `supabase/aplicar-0023-a-0023.sql` en el
   SQL Editor). Hacelo **antes** de cargar la clave: así los emails viejos de prueba vencen y no salen. Después,
   la fila 30 de `supabase/checks/2-verificacion.sql` tiene que decir OK.
2. Tené a mano la casilla de soporte (por ejemplo `soporte@estudiapp.app`). Tiene que existir y recibir correo.

## 1. Crear la cuenta y agregar el dominio

1. Creá la cuenta en [resend.com](https://resend.com) con el email del proyecto.
2. **Domains → Add Domain** y escribí `mail.estudiapp.app`.
3. En **Region** elegí **São Paulo (sa-east-1)**, que es la más cercana a Argentina. La región queda fija para
   ese dominio: si te equivocás, hay que borrarlo y agregarlo de nuevo.
4. Resend muestra los registros DNS que hay que crear: un **MX** y un **TXT (SPF)** bajo `send.mail`, y un
   **TXT (DKIM)** bajo `resend._domainkey.mail`.

## 2. Cargar los registros en Cloudflare

El dominio `estudiapp.app` está en Cloudflare, así que hay dos caminos:

- **Automático (recomendado):** en la pantalla del dominio en Resend, el botón **Sign in to Cloudflare** crea
  los registros solo, después de que autorizás el acceso.
- **A mano:** en Cloudflare, **estudiapp.app → DNS → Records → Add record**, uno por cada registro que muestra
  Resend. En «Name» va solo la parte del subdominio (`send.mail`, `resend._domainkey.mail`), no el dominio
  completo. El MX va con prioridad 10. Si algún registro es CNAME, tiene que quedar con la **nube gris («DNS
  only»)**: con la nube naranja la verificación no termina.

Estos registros van en `mail.estudiapp.app` y no tocan el correo de `estudiapp.app`.

**Recomendado: DMARC.** Si `estudiapp.app` todavía no tiene un registro `_dmarc`, agregá un TXT con nombre
`_dmarc` y valor `v=DMARC1; p=none;`. Gmail y Yahoo lo piden a quien manda volumen, y ayuda a no caer en spam.

Volvé a Resend y apretá **Verify DNS Records**. Suele tardar unos minutos. El dominio tiene que quedar
**Verified**.

**En la configuración del dominio, dejá apagados «Click tracking» y «Open tracking».** El seguimiento de clics
cambia los enlaces de los emails por enlaces de Resend, y el de aperturas agrega una imagen invisible. Los
avisos de EstudiApp no los necesitan.

## 3. Crear la clave

1. **API Keys → Create API Key**.
2. Nombre: `estudiapp-produccion`. Permiso: **Sending access**. Dominio: `mail.estudiapp.app`.
3. Copiá la clave (empieza con `re_`). Resend la muestra una sola vez. **No la pegues en el chat, en Git ni en
   un documento.**

## 4. Cargar las variables en Cloudflare

En **Workers & Pages → estudiapp → Settings → Variables and Secrets → Production**:

| Nombre | Tipo | Valor |
| --- | --- | --- |
| `RESEND_API_KEY` | **Secret** | la clave `re_...` |
| `EMAIL_FROM` | Text | `EstudiApp <avisos@mail.estudiapp.app>` |
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
   que no es de `mail.estudiapp.app`.
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
