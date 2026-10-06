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

- **Aplicá `supabase/migrations/0006_visibility_and_hardening.sql`.** Sin ella el alumno no ve sus reservas, la ficha de revisión del admin no muestra las materias, y cualquier usuario puede cambiarse el rol a administrador o aprobarse como docente desde la API de Supabase. No se probó contra un proyecto real: revisala antes.
- Sigue abierto: `tutor_profiles_select_public_when_approved` es por fila y expone todas las columnas de un docente aprobado, incluidas `contacto_verificacion`, `credential_url` y `mercadopago_account_id`. Cerrarlo exige mover esos datos a una tabla privada (o a una vista) y cambiar las consultas de la app.
- Las server actions de aprobar y rechazar verifican el rol en la app, pero la barrera real es la RLS.

Funcional:

- El docente no ve el nombre de sus alumnos: la RLS de `profiles` no se lo permite.
- Reserva, pago (Mercado Pago), sala de video, calificaciones, disponibilidad del docente y gestión de contenido siguen como vista de muestra. El orden recomendado está en `Roadmap-Implementacion-EstudiApp.md` de la carpeta del proyecto de diseño.
- `ratings` no guarda quién califica en la vista pública: las opiniones se muestran como «Estudiante de EstudiApp».
- La búsqueda de texto del catálogo ignora tildes en el servidor de la app (no en SQL). Con un catálogo grande conviene moverla a la base con `unaccent`.
