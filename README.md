# EstudiApp

Plataforma para encontrar profesores con trayectoria comprobada y tomar clases individuales online. Está pensada para estudiantes universitarios argentinos y docentes con experiencia.

Next.js 16 (App Router) · React 19 · Supabase (auth y base de datos) · GSAP para la animación del hero. Los estilos son CSS plano con la identidad de marca (sin Tailwind).

## Ejecutar localmente

1. Creá el proyecto de Supabase y aplicá las migraciones de `supabase/migrations/` (ver [supabase/README.md](supabase/README.md)).
2. Copiá `.env.local.example` a `.env.local` y completá `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Si querés que el correo de recuperación de contraseña apunte a un dominio fijo, definí también `NEXT_PUBLIC_SITE_URL`.
3. Instalá y levantá:

```bash
npm install
npm run dev
```

La app queda en <http://localhost:3000>. Para cargar datos de ejemplo (docentes, reservas) usá `npm run seed:demo`; las instrucciones están en `supabase/README.md`.

Antes de entregar cambios (el CI de GitHub corre lo mismo en cada cambio):

```bash
npm run check   # tipos + lint + pruebas unitarias + pruebas de la base de datos
npm run build
```

Las pruebas de la base de datos (`npm run test:db`) aplican las migraciones reales sobre un Postgres en memoria y comprueban la RLS rol por rol; no necesitan Supabase. Ver [supabase/tests](supabase/tests/README.md).

## Hoja de ruta

El proyecto se construye por fases, ordenadas por prioridad. Ver [ROADMAP.md](ROADMAP.md): las fases 0 a 2 están cerradas y se trabaja en la **Fase 4 (calidad y lanzamiento)**. El sitio se publica solo con cada push a `main`; los pasos del lanzamiento están en [docs/CLOUDFLARE.md](docs/CLOUDFLARE.md).

## Qué funciona

| Área | Estado |
| --- | --- |
| Home, Cómo funciona, legales | Funcionan. Los textos legales son preliminares. |
| Registro, login, recuperar contraseña | Funcionan (Supabase Auth). |
| Catálogo y perfil público del docente | Funcionan con datos reales (búsqueda sin tildes, filtros, páginas de a 10, horarios y opiniones). |
| Alumno: inicio, próximas clases, historial, perfil | Funcionan con datos reales. |
| Docente: inicio, perfil profesional (3 pasos), disponibilidad (abrir y cerrar franjas de 60 min) | Funcionan con datos reales. La disponibilidad requiere la migración 0007. |
| Reservas: elegir un horario libre, retenerlo 15 min, pagar, cancelar | Funcionan con datos reales. El pago con tarjeta (Mercado Pago, Checkout API) está hecho y probado contra un proveedor simulado; la prueba con Mercado Pago real es el último paso antes del lanzamiento. Para desarrollo hay un pago simulado (`ALLOW_SIMULATED_PAYMENTS`). |
| Admin: solicitudes, ficha (aprobar, rechazar, reabrir, dar de baja), rechazados, docentes activos, métricas, comisión, contenido del inicio, registro de acciones, emails y estado del sistema | Funcionan con datos reales. |
| Sala de clase | **Real** con Daily.co (`DAILY_API_KEY`): sala privada por reserva, solo alumno y docente, desde 10 minutos antes hasta el final de la clase. No se graba. La clase cuenta como dada si el docente estuvo al menos 10 minutos; si no, se devuelve el 100 %. Al terminar, el alumno califica la clase (también desde su historial, hasta 30 días después). |
| Docente: cuenta de cobro y cobros | Funcionan con datos reales (vinculación con Mercado Pago probada solo con credenciales de prueba). |

## Estructura

- `src/app/(public)`: Home, catálogo (`/docentes`), perfil público, Cómo funciona y legales.
- `src/app/(auth)`: login, registro, recuperar y actualizar contraseña.
- `src/app/alumno`, `src/app/docente`, `src/app/admin`: espacios por rol. El proxy (`src/proxy.ts`) exige sesión y rol.
- `src/components`: pantallas y primitives de la interfaz. Cada área tiene su CSS (`home.css`, `public-pages.css`, `student-pages.css`, `management-pages.css`) y se cargan desde el layout raíz.
- `src/lib`: Supabase, validaciones (Zod), consultas y formatos. Las fechas se muestran siempre en hora de Argentina (`src/lib/format.ts`).
- `supabase/migrations`: modelo de datos y RLS.

## Identidad visual

Black Forest `#023618`, Floral White `#FFFCF2`, Spicy Paprika `#EB5E28`, Oxidized Iron `#B02E0C` y Dust Grey `#CCC5B9`. Bricolage Grotesque para titulares y Figtree para lectura e interfaz. La mascota y los logos de `public/brand/` provienen del BrandBook: no se sustituyen ni se cambian sus proporciones. El hero de la Home (pizarra verde, mascota con útiles y cursor de lápiz) es una decisión central de diseño.

## Pendiente conocido

Ver «Pendiente conocido» en [CLAUDE.md](CLAUDE.md) y el [ROADMAP](ROADMAP.md). Lo más importante antes del lanzamiento: los textos legales definitivos, la prueba con Mercado Pago real y encender la indexación (`SITE_INDEXABLE`).
