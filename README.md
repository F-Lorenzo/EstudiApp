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

El proyecto se construye por fases, ordenadas por prioridad. Ver [ROADMAP.md](ROADMAP.md): ahora estamos en la **Fase 0 (bases sólidas)**; después, el cobro real con Mercado Pago.

## Qué funciona y qué es una vista de muestra

| Área | Estado |
| --- | --- |
| Home, Cómo funciona, legales | Funcionan. Los textos legales son preliminares. |
| Registro, login, recuperar contraseña | Funcionan (Supabase Auth). |
| Catálogo y perfil público del docente | Funcionan con datos reales (búsqueda, filtros, horarios y opiniones). |
| Alumno: inicio, próximas clases, historial, perfil | Funcionan con datos reales. |
| Docente: inicio, perfil profesional (3 pasos), disponibilidad (abrir y cerrar franjas de 60 min) | Funcionan con datos reales. La disponibilidad requiere la migración 0007. |
| Reservas: elegir un horario libre, retenerlo 15 min, pagar, cancelar | Funcionan con datos reales (migraciones 0008 y 0009). **El cobro con Mercado Pago todavía no existe:** hay un pago simulado solo para desarrollo (`ALLOW_SIMULATED_PAYMENTS`). |
| Admin: solicitudes, ficha con aprobar o rechazar, docentes activos, métricas | Funcionan con datos reales. |
| Sala de clase | **Vista de muestra** (banner visible). |
| Docente: cuenta de cobro. Admin: contenido | **Vista de muestra**. No guardan nada. |

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

Ver «Pendiente conocido» en [CLAUDE.md](CLAUDE.md) y el [ROADMAP](ROADMAP.md). Lo más importante: **aplicar las migraciones 0006 a 0010 en orden** (sin ellas el alumno no ve sus reservas y la RLS tiene huecos de seguridad), y construir reservas y pagos reales, sala de video, disponibilidad y gestión de contenido.
