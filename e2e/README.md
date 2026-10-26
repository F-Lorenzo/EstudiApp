# Pruebas de punta a punta

El recorrido completo de EstudiApp en un navegador (Playwright), con la app real y un **Supabase local** (base,
autenticación y API reales, en Docker). Nada de esto toca el proyecto de Supabase real.

```
registro del docente → perfil → aprobación de la administración → cuenta de cobro y horarios →
registro del alumno → búsqueda → reserva → pago (simulado) → cobros del docente → clase → calificación →
opinión pública
```

Además de lo que se ve en pantalla, cada paso comprueba la base: el estado del perfil y de la reserva, el registro
de acciones, el reparto del pago con la comisión (15.000 = 1.800 + 13.200) y los emails anotados en la bandeja.

## Correrlas

Hace falta Docker andando y `psql`.

```bash
npm run e2e:supabase     # levanta el Supabase local (la primera vez baja las imágenes)
npx playwright install chromium   # la primera vez
npm run e2e              # vacía la base, aplica las migraciones, levanta la app y corre el recorrido
```

`npm run e2e` vacía la base local en cada corrida (`scripts/e2e-db.mjs`) y le aplica todas las migraciones con
el mismo archivo único que se usa para un proyecto nuevo (`npm run db:bundle`). Si falla, el informe queda en
`test-results/` (captura y traza de cada paso): `npx playwright show-trace test-results/<carpeta>/trace.zip`.

Para apagar el Supabase local: `npx supabase stop --workdir e2e`.

En la nube de Claude Code el navegador ya está instalado en otra ruta:
`PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run e2e`.

## Qué se hace en la base y por qué

Lo que no se puede hacer desde la app se hace con SQL directo (`e2e/db.ts`), como desde el SQL Editor:

- **El rol de administración.** Desde la app nadie puede dárselo (migración 0006).
- **La cuenta de Mercado Pago del docente.** Se anota una de mentira: vincular una de verdad necesita Mercado Pago.
- **El pago.** Es el pago simulado (`ALLOW_SIMULATED_PAYMENTS=true`, solo con `next dev`). El cobro con tarjeta
  real se prueba aparte contra Mercado Pago (Fase 4, ítem 7).
- **La clase.** Se adelanta el reloj (la clase pasa a ser de ayer) y la asistencia se anota con
  `record_class_attendance`, la función que usa el servidor con los datos de Daily.

Las cuentas confirman el email solas (`enable_confirmations = false` en `e2e/supabase/config.toml`): no hay
servidor de correo. Resend tampoco está configurado, así que los emails quedan en la bandeja y la prueba
comprueba que estén.
