@AGENTS.md

# Guía para continuar EstudiApp

Este repo combina la funcionalidad (Supabase, roles, aprobación de docentes) con el diseño aprobado de EstudiApp. Leé el [README](README.md) para ejecutar el proyecto y ver qué es real y qué es vista de muestra.

## Antes de cambiar código

- Conservá la identidad: Black Forest `#023618`, Floral White `#FFFCF2`, Spicy Paprika `#EB5E28`, Oxidized Iron `#B02E0C`, Dust Grey `#CCC5B9`. Bricolage Grotesque para titulares, Figtree para lectura e interfaz.
- El hero de la Home es una decisión central: pizarra verde oscuro, mascota oficial con útiles y cursor de lápiz (`public/brand/pencil-cursor.svg`). La mirada sigue el cursor y la cabeza rota suavemente (`src/components/mascot.tsx`). No lo sustituyas por imágenes generadas ni cambies las proporciones de los logos o la mascota.
- El tono es cercano, claro y respaldado por experiencia. No prometas resultados académicos garantizados.
- Los estilos son CSS plano con clases con prefijo por área (`pub-`, `stu-`, `mgmt-`). No hay Tailwind. Las fechas se muestran en hora de Argentina con los helpers de `src/lib/format.ts`.
- Mantené los estados vacíos, de carga, éxito y error ya diseñados. La revisión visual debe incluir escritorio, móvil y `prefers-reduced-motion`.

## Convenciones del código

- Las páginas son componentes de servidor que leen Supabase y le pasan datos serializables a componentes de cliente (`"use client"`) que solo manejan interacción.
- Las mutaciones son server actions con validación Zod (`src/lib/validation`). Un campo que la base no tiene (años de experiencia, universidad) queda en `null` y la interfaz lo omite.
- Las pantallas que todavía no tienen backend muestran `<SampleBanner>` y no persisten nada. Al conectarlas, quitá el banner.

## Cómo se trabaja

- El plan está en [ROADMAP.md](ROADMAP.md): fases ordenadas por prioridad de construcción, cada una con su criterio de salida. **No empieces trabajo de una fase posterior mientras la anterior tenga huecos de seguridad o sin pruebas.** Estado actual: Fase 0 (bases sólidas).
- `npm run check` (tipos, lint, pruebas unitarias y de base de datos) tiene que pasar antes de fusionar; el CI de GitHub corre lo mismo.
- Toda regla que mueve dinero o protege datos vive en la base (funciones y RLS) **y** tiene un caso en `supabase/tests` que intenta romperla.
- Una migración que ya se aplicó en un proyecto real no se edita: se agrega una nueva. Las que todavía no se aplicaron en ninguno (0006 a 0010) se pueden corregir.
- Los datos privados del docente (contacto, respaldo y cuenta de Mercado Pago) viven en `tutor_private`, nunca en `tutor_profiles`, que es legible por cualquiera.

## Versiones (actualizadas al 8 de octubre de 2026)

Todo está en la última versión estable, con tres excepciones a propósito:

- **TypeScript 6.0.3, no 7.** Con TypeScript 7 el build y `tsc` funcionan, pero el lint se rompe: `typescript-eslint` (que trae `eslint-config-next`) solo soporta hasta la 6.0.x. Subir a la 7 cuando `typescript-eslint` lo soporte (`npm ls typescript` no debe mostrar «invalid»).
- **Node 24 (LTS), no 26.** La 26 todavía es «Current». `@types/node` sigue en la 24 para coincidir con lo que corre. Pasar a la 26 cuando sea LTS y Vercel la ofrezca.
- **ESLint 10 con aviso de npm.** Tres plugins que trae `eslint-config-next` (`import`, `jsx-a11y`, `react`) todavía no declaran soporte para ESLint 10 y npm avisa «overriding peer dependency». Se comprobó que sus reglas siguen funcionando (hooks, `key`, `alt`, `<img>`). Si alguna vez el lint falla de forma rara, la primera sospecha es esta: volver a ESLint 9 es `npm install -D eslint@9`.

## Pendiente conocido

Base de datos (aplicar antes de usar la app con datos reales):

- **Aplicá las migraciones 0006, 0007, 0008, 0009 y 0010 (`supabase/migrations`), en orden.** Sin la 0006 el alumno no ve sus reservas, la ficha de revisión del admin no muestra las materias, y cualquier usuario puede cambiarse el rol a administrador o aprobarse como docente desde la API de Supabase. Sin la 0009 cualquier cuenta puede crearse un perfil de docente ya «aprobado» (y la 0008 lo convierte en un camino de cobro). Se probaron con 96 casos en un Postgres real, pero no contra tu proyecto de Supabase: revisalas antes.
- Resuelto en la 0010: `tutor_profiles_select_public_when_approved` es por fila y exponía todas las columnas de un docente aprobado. El contacto, el respaldo y la cuenta de Mercado Pago pasaron a `tutor_private` (solo el dueño y la administración). Lo que queda público en `tutor_profiles` es a propósito: biografía, formación, tarifa, calificación y estado de verificación.
- Las server actions de aprobar y rechazar verifican el rol en la app, pero la barrera real es la RLS.

Funcional:

- La RLS ya deja que el docente lea el nombre y la foto de sus alumnos (migración 0008), pero el panel del docente todavía no los muestra (`src/lib/bookings/tutor-queries.ts`).
- Las reservas ya son reales (migración 0008): el alumno elige un horario libre, queda retenido 15 minutos como «pendiente_pago» y se confirma al registrarse el pago. Máximo dos reservas sin pagar por alumno. La reserva guarda su propio horario y precio. **No hay cobro real:** falta el checkout de Mercado Pago, el webhook y los reembolsos (`cancel_booking` rechaza reservas ya pagas). Para probar el recorrido existe un pago simulado, apagado por defecto (`ALLOW_SIMULATED_PAYMENTS=true`, solo en desarrollo o previews; nunca en producción).
- **Contrato del webhook de pago:** tiene que llamar a `confirm_booking_payment` con la service role. Si la función devuelve cualquier error (`hold_expired`, `not_pending`, `class_started`, `amount_mismatch`, `invalid_commission`, `duplicate_payment`; el código va en `hint`), el pago recibido **hay que reembolsarlo**: no quedó asociado a una clase. Repetir el mismo pago es idempotente. Conviene fijar la expiración de la preferencia de Mercado Pago en los 15 minutos de la reserva.
- Las reservas vencidas y las clases terminadas se actualizan al leer (`syncBookings`, función `sync_bookings()`), no con un cron. Si el sitio tiene poco tráfico, alcanza igual porque todas las pantallas que muestran horarios la ejecutan; programarla con pg_cron es opcional. Una clase confirmada pasa a «completada» sola al terminar su horario, sin comprobar asistencia: cuando exista la sala de video conviene revisar esa regla.
- Sin límite de frecuencia: el tope de dos reservas sin pagar evita acaparar horarios, pero un script puede seguir llamando a las funciones. Falta limitar por IP o por cuenta.
- Sala de video, calificaciones y gestión de contenido siguen como vista de muestra. La disponibilidad del docente ya es real (`/docente/disponibilidad`, migración 0007). El orden recomendado está en `Roadmap-Implementacion-EstudiApp.md` de la carpeta del proyecto de diseño.
- `ratings` no guarda quién califica en la vista pública: las opiniones se muestran como «Estudiante de EstudiApp».
- La búsqueda de texto del catálogo ignora tildes en el servidor de la app (no en SQL). Con un catálogo grande conviene moverla a la base con `unaccent`.
