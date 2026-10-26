# Despliegue con OpenNext

El Worker existente es `estudiapp`, con dominio personalizado `estudiapp.app`.
`wrangler.jsonc` configura `nodejs_compat`, assets, Images y observabilidad.

Usar Node 24 y las versiones del lockfile:

```bash
npm ci
npm run cf-typegen
npm run preview
```

`preview` compila y ejecuta el Worker localmente. `npm run dev` sigue usando
el servidor de desarrollo de Next.js.

Antes de compilar para producción, proporcionar `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY` y `NEXT_PUBLIC_SITE_URL=https://estudiapp.app`
en el entorno de build o en `.env.local` (ignorado por Git). Next.js incorpora
las variables `NEXT_PUBLIC_*` al bundle: las variables del dashboard no se
descargan automáticamente al compilar. Verificar que coincidan con producción.

Además, cargar en **Workers & Pages → estudiapp → Settings → Runtime variables
and secrets → Production** las variables solo de servidor: `SUPABASE_SERVICE_ROLE_KEY`,
`MERCADOPAGO_CLIENT_ID`, `MERCADOPAGO_CLIENT_SECRET`,
`MERCADOPAGO_WEBHOOK_SECRET`, `MERCADOPAGO_TOKEN_ENCRYPTION_KEY`, `RESEND_API_KEY`,
`EMAIL_FROM`, `EMAIL_REPLY_TO` y `CRON_SECRET` (`EMAIL_FROM` y `EMAIL_REPLY_TO` pueden ir como texto; el resto,
como secretos; Resend paso a paso en [RESEND.md](RESEND.md)). El código de servidor lee los bindings runtime de
OpenNext; no alcanza con definir estos secretos exclusivamente durante el build.

Wrangler usa `keep_vars: true` para conservar las variables existentes del
dashboard que todavía no se hayan trasladado al código. No reemplazarlas con
placeholders. No guardar tokens de Cloudflare, claves privadas de Supabase ni
credenciales de Mercado Pago en `vars` o en Git. `WORKER_SELF_REFERENCE` es un service binding al Worker `estudiapp` en
`production`, verificado mediante la API de Cloudflare y declarado en Wrangler.

Proporcionar `CLOUDFLARE_API_TOKEN` de forma segura con acceso al Worker
existente (Workers Scripts:Edit y los permisos de cuenta/dominio necesarios).
Si el token tiene acceso a varias cuentas, seleccionar la correcta mediante
`CLOUDFLARE_ACCOUNT_ID`. Luego:

```bash
npm run deploy
curl -fSs -D /tmp/estudiapp-headers https://estudiapp.app/ -o /tmp/estudiapp.html
```

`deploy` ejecuta `opennextjs-cloudflare build` seguido de
`opennextjs-cloudflare deploy`. Confirmar HTTP 200 y contenido HTML de la app;
también comprobar login y catálogo. El build validado localmente no demuestra
que producción haya sido actualizada.

## Límites por IP y Turnstile

El login, el registro y la recuperación de contraseña pasan por `src/lib/security/auth-guard.ts` (decisión del 26 de
octubre de 2026):

- **Límite por IP:** los bindings `LOGIN_RATE_LIMITER` (10 por minuto, por IP y por email) y `SIGNUP_RATE_LIMITER`
  (5 por minuto por IP, registro y recuperación) están declarados en `wrangler.jsonc` (`ratelimits`). Se crean solos
  con el próximo `npm run deploy`; no hay nada que configurar en el panel. Cuentan por ubicación de Cloudflare, así
  que no son una cuenta exacta. Fuera de un Worker (`next dev`, pruebas) no limitan.
- **Turnstile:** se enciende cuando están las dos claves. Pasos:
  1. Cloudflare → **Turnstile → Add widget**. Nombre: `EstudiApp`. Hostnames: `estudiapp.app` (y el de los previews
     si se usan). Modo: **Managed**. Pre-clearance: no.
  2. Copiá la **Site Key** y la **Secret Key**.
  3. En **Workers & Pages → estudiapp → Settings → Variables and Secrets → Production**: `TURNSTILE_SITE_KEY` como
     texto y `TURNSTILE_SECRET_KEY` como **secreto**. La clave pública se lee en el servidor, no hace falta volver a
     compilar.
  4. Abrí `/login` en una ventana privada e ingresá: casi siempre no se ve nada; a veces aparece una casilla para tocar.
  Turnstile se exige solo cuando están las dos claves; con una sola queda apagado.

## Cron de mantenimiento

`wrangler.jsonc` apunta `main` a `cloudflare-worker.ts`: es el Worker que genera OpenNext
(`.open-next/worker.js`) más un handler `scheduled`. El cron (`triggers.crons`, cada hora a los 7 minutos)
le pide por dentro, sin salir a la red, la ruta `/api/cron/payments-maintenance` con el secreto
`CRON_SECRET` (la lógica está en `src/lib/cron/scheduled.ts`). La ruta renueva los tokens de Mercado
Pago, registra la asistencia de las clases terminadas, reintenta reembolsos y envía los emails pendientes.

- `CRON_SECRET` tiene que estar cargado como **secreto** del Worker. Sin él, la ruta no corre nada y cada
  ejecución del cron figura como fallida.
- Las ejecuciones se ven en **Workers & Pages → estudiapp → Settings → Trigger Events** (o en los logs, con
  `source: "cron"`). Una ejecución en rojo es un barrido que falló: el informe va en el log.
- Para probarlo sin esperar la hora: `npx wrangler dev --test-scheduled` y luego
  `curl "http://localhost:8787/__scheduled?cron=7+*+*+*+*"` (después de `opennextjs-cloudflare build`).

## Lanzamiento

El sitio se publica solo: cada push a `main` lo compila y despliega Cloudflare (Workers Builds). Las variables
`NEXT_PUBLIC_*` tienen que estar en el entorno del build (Settings → Build → Variables); las demás, en las del Worker.

1. Abrí **`/admin/sistema`** con la cuenta de administración. Muestra, sin ninguna clave, qué variables están
   cargadas y con la forma correcta: la dirección del sitio, la base al día, las claves de Mercado Pago (incluida la
   **firma de los avisos**, `MERCADOPAGO_WEBHOOK_SECRET`, que se exige siempre: sin ella se rechazan todos los
   avisos), la dirección del aviso para cargar en Mercado Pago, Daily, Resend, el cron, Turnstile y los
   limitadores. También avisa si quedó encendido algo de prueba (`MERCADOPAGO_OAUTH_TEST_TOKEN`,
   `ALLOW_SIMULATED_PAYMENTS`). Todo tiene que decir **OK**; la indexación figura como «Apagado» a propósito.
2. **Indexación:** con todo en orden y los textos legales definitivos, cargá `SITE_INDEXABLE` = `true` (como texto)
   en las variables del Worker. No hace falta desplegar: desde el pedido siguiente las páginas dicen «index»,
   `robots.txt` se abre (menos `/admin`, `/alumno`, `/docente`, `/api` y `/auth`) y `sitemap.xml` lista las páginas
   públicas y el perfil de cada docente aprobado. Solo vale en la dirección de `NEXT_PUBLIC_SITE_URL`: una versión
   de prueba en otra dirección nunca se indexa. Para volver atrás, borrá la variable.
3. Después de encenderla, cargá `https://estudiapp.app/sitemap.xml` en Google Search Console.

## Manifiesto de preview

Con Next.js 16.4.1 y OpenNext 1.20.12 el build genera
`.next/server/preview-props.json`, lo copia a
`.open-next/server-functions/default/.next/server/preview-props.json` y lo
incorpora al handler del servidor. El adaptador tiene un parche explícito para
esta ruta en `dist/cli/build/patches/plugins/load-manifest.js`.

No se espera `.open-next/assets/.next/server/preview-props.json`: `assets` es
contenido público. No copiar allí manifiestos internos para resolver errores.
Ante `Unexpected loadManifest`, verificar la compatibilidad del adaptador con
Next.js, el manifiesto del servidor y el bundle generado.
