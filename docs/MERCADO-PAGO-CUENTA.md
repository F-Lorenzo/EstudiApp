# Mercado Pago — lo que tenés que crear (una sola vez)

EstudiApp cobra con **Mercado Pago, modelo Marketplace (Split de pagos 1:1)**: el alumno paga en la
página de Mercado Pago, la plata del docente le llega directo a **su** cuenta de Mercado Pago y la
comisión de la plataforma (12 %) queda en **la cuenta de la plataforma**. Por eso hacen falta dos
tipos de cuenta:

| Cuenta | Quién es | Qué hace |
|---|---|---|
| **La de la plataforma** | Vos (o la sociedad que va a cobrar la comisión) | Es dueña de la aplicación, recibe la comisión y firma los cobros |
| **La de cada docente** | Cada docente, en el futuro | Se vincula a EstudiApp con un botón («Conectar mi cuenta de Mercado Pago») y recibe lo suyo |

Hoy solo necesitás la primera, más cuentas **de prueba** que Mercado Pago te da gratis para simular
docentes y alumnos. **Con dinero de prueba no se mueve plata real.**

> **Regla de oro:** estos datos son secretos y **no se pegan en el chat, en Trello ni en el repo**:
> *Access Token*, *Client Secret*, *clave secreta de Webhooks* y las contraseñas de las cuentas de prueba.
> Se guardan en un gestor de contraseñas y se cargan solo en Vercel (y en tu `.env.local`).
> **No son secretos** y sí me los podés pasar: el número de la aplicación (*Client ID* / *APP ID*) y los
> *User ID* de las cuentas de prueba.

---

## Paso 1 — La cuenta de la plataforma (10 a 30 min, más la verificación)

1. Entrá a Mercado Pago con la cuenta de quien va a **recibir la comisión**. Puede ser tu cuenta
   personal de Mercado Pago / Mercado Libre, o la de una sociedad o monotributo si ya lo tenés.
2. Completá la **verificación de identidad** (DNI y selfie; con CUIT si es una empresa) desde tu
   perfil. Mercado Pago te la va a pedir al crear la aplicación, y **es lo que más puede demorar
   (a veces horas o días)**, así que conviene arrancar ya.
3. Pensalo con tu contador antes del lanzamiento: la comisión que cobrás es un ingreso tuyo y
   tributa (monotributo / IVA / ingresos brutos según tu caso). No bloquea las pruebas.

## Paso 2 — Crear la aplicación (5 min)

1. Abrí **Tus integraciones**: <https://www.mercadopago.com.ar/developers/panel/app>
2. **Crear aplicación** (arriba a la derecha).
3. Completá, en este orden:
   - **Nombre:** `EstudiApp` (hasta 50 caracteres).
   - **Solución:** *Pagos online*.
   - **Producto:** *Checkout Pro*.
   - **Modelo de integración:** ***Marketplace***. Este es el punto clave: es el que habilita el
     split de pagos y la vinculación de docentes.
4. **Crear aplicación.** Si te pide reautenticarte o verificar tu cuenta, hacelo.

## Paso 3 — Cuentas de prueba (5 min)

En tu aplicación → **Cuentas de prueba** → **Crear cuenta de prueba**. Hacé como mínimo:

| Tipo | Para qué | Nota |
|---|---|---|
| **Comprador** | Hace de alumno | Cargale dinero ficticio si te lo pide |
| **Vendedor** | Hace de docente | Mercado Pago ya crea uno solo al crear la aplicación; creá otro si querés dos docentes |

- Elegí **el mismo país (Argentina) para todas**: no se puede cambiar después.
- Podés crear hasta 15 y **no se pueden borrar**, así que no crees de más.
- Anotá el usuario y la contraseña de cada una (en tu gestor de contraseñas). Para entrar con una
  cuenta de prueba, si te pide un código por email, está en la misma tabla de «Cuentas de prueba».
- Si en la lista de tipos aparece **Integrador**, creá una también (es el tipo para marketplaces).

## Paso 4 — Credenciales de la aplicación (5 min)

En tu aplicación → **Detalles de aplicación → Credenciales**. Vas a ver dos pestañas: **Pruebas** y
**Producción**. **Por ahora usá solo las de Pruebas.** Anotá (en el gestor de contraseñas):

| Dato | Dónde | ¿Secreto? |
|---|---|---|
| **Client ID** (el número de la aplicación) | Detalles de aplicación | No |
| **Client Secret** | Detalles de aplicación | **Sí** |
| **Public Key** | Credenciales | No (pero no hace falta pasarla) |
| **Access Token** de pruebas | Credenciales | **Sí** |

## Paso 5 — URL de redirección (2 min)

Sirve para que, cuando un docente apriete «Conectar mi cuenta de Mercado Pago», vuelva a EstudiApp
con la autorización. En tu aplicación, campo **Redirect URL** (aparece también como `redirect_uri`):

```
https://TU-DOMINIO-DE-VERCEL/api/mercadopago/oauth/callback
```

- Tiene que ser una URL **fija, con https** y **exactamente igual** a la que use la app. Usá el
  dominio de producción de Vercel (no sirve el de una vista previa, que cambia en cada cambio).
- Todavía no existe esa ruta en la app: la construyo yo. Cargá el campo ahora para no olvidarlo.

## Paso 6 — Webhooks (después de que te avise)

Es el aviso que Mercado Pago le manda a EstudiApp cuando un pago se aprueba, se rechaza o se
reembolsa. Lo configurás **cuando yo te diga que la ruta ya está subida**, porque necesita la URL
`https://TU-DOMINIO-DE-VERCEL/api/mercadopago/webhook`:

1. Tu aplicación → **Webhooks → Configurar notificaciones**.
2. Pestaña **Modo de prueba**: pegá esa URL y activá el evento **Pagos**.
3. **Revelá y copiá la clave secreta** (va al gestor de contraseñas; la usa la app para comprobar
   que el aviso viene de verdad de Mercado Pago).

## Paso 7 — Cargar las claves (cuando yo te avise)

Cuando esté lista la parte de la app que las usa, te pido que las cargues **en Vercel → Settings →
Environment Variables** (y, si querés probar en tu máquina, en `.env.local`):

| Variable | Valor |
|---|---|
| `MERCADOPAGO_CLIENT_ID` | El Client ID |
| `MERCADOPAGO_CLIENT_SECRET` | El Client Secret |
| `MERCADOPAGO_WEBHOOK_SECRET` | La clave secreta de Webhooks |
| `SUPABASE_SERVICE_ROLE_KEY` | La clave `service_role` de Supabase (Project Settings → API). **Solo** en Vercel y `.env.local`, nunca en el chat |
| `MERCADOPAGO_TOKEN_ENCRYPTION_KEY` | Una clave que genero yo con un comando (te lo doy en ese momento) |

El *Access Token* de la plataforma probablemente no haga falta: cada cobro se hace con el token del
docente que se vinculó por OAuth. Si hace falta, te lo aviso.

---

## Producción (más adelante, no ahora)

Para cobrar plata real hay que **activar las credenciales de producción** de la aplicación, y para
eso Mercado Pago pide la cuenta verificada y que completes el formulario de la aplicación (nombre del
sitio, rubro, etc.). Se hace en la Fase 4, con un cobro real de bajo monto. Los docentes reales
también tienen que tener su cuenta de Mercado Pago verificada para cobrar.

## Qué mandarme cuando termines

Un mensaje así, **sin ninguna clave**:

> Listo. Client ID: `123456789…`. Creé el comprador y el vendedor de prueba (User ID: `…` y `…`).
> La Redirect URL ya está cargada. Mercado Pago [pidió / no pidió] verificar mi identidad.

Si en alguna pantalla ves algo distinto a lo que dice esta guía (Mercado Pago cambia los paneles
seguido), mandame una captura y ajusto la guía.

Fuentes (documentación oficial de Mercado Pago Argentina):
[Split de pagos 1:1 — integrar marketplace](https://www.mercadopago.com.ar/developers/es/docs/split-payments/split-1-1/integration-configuration/integrate-marketplace) ·
[Crear configuración](https://www.mercadopago.com.ar/developers/es/docs/split-payments/split-1-1/integration-configuration/create-configuration) ·
[Cuentas de prueba](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-preferences/test-accounts) ·
[OAuth](https://www.mercadopago.com.ar/developers/es/docs/security/oauth/creation) ·
[Notificaciones de pago](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro/payment-notifications)
