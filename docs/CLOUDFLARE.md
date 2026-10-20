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
