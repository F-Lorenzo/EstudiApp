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

## Pendiente conocido

Base de datos (aplicar antes de usar la app con datos reales):

- **Aplicá las migraciones 0006, 0007 y 0008 (`supabase/migrations`).** Sin la 0006 el alumno no ve sus reservas, la ficha de revisión del admin no muestra las materias, y cualquier usuario puede cambiarse el rol a administrador o aprobarse como docente desde la API de Supabase. Se probaron con 56 casos en un Postgres real, pero no contra tu proyecto de Supabase: revisalas antes.
- Sigue abierto: `tutor_profiles_select_public_when_approved` es por fila y expone todas las columnas de un docente aprobado, incluidas `contacto_verificacion`, `credential_url` y `mercadopago_account_id`. Cerrarlo exige mover esos datos a una tabla privada (o a una vista) y cambiar las consultas de la app.
- Las server actions de aprobar y rechazar verifican el rol en la app, pero la barrera real es la RLS.

Funcional:

- El docente no ve el nombre de sus alumnos: la RLS de `profiles` no se lo permite.
- Las reservas ya son reales (migración 0008): el alumno elige un horario libre, queda retenido 15 minutos como «pendiente_pago» y se confirma al registrarse el pago. **No hay cobro real:** falta el checkout de Mercado Pago, el webhook (debe llamar a `confirm_booking_payment` con la service role) y los reembolsos (`cancel_booking` rechaza reservas ya pagas). Para probar el recorrido existe un pago simulado, apagado por defecto (`ALLOW_SIMULATED_PAYMENTS=true`, nunca en producción de Vercel).
- Sala de video, calificaciones y gestión de contenido siguen como vista de muestra. La disponibilidad del docente ya es real (`/docente/disponibilidad`, migración 0007). El orden recomendado está en `Roadmap-Implementacion-EstudiApp.md` de la carpeta del proyecto de diseño.
- `ratings` no guarda quién califica en la vista pública: las opiniones se muestran como «Estudiante de EstudiApp».
- La búsqueda de texto del catálogo ignora tildes en el servidor de la app (no en SQL). Con un catálogo grande conviene moverla a la base con `unaccent`.
