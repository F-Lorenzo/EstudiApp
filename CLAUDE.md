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

- **Aplicá las migraciones 0006, 0007, 0008 y 0009 (`supabase/migrations`), en orden.** Sin la 0006 el alumno no ve sus reservas, la ficha de revisión del admin no muestra las materias, y cualquier usuario puede cambiarse el rol a administrador o aprobarse como docente desde la API de Supabase. Sin la 0009 cualquier cuenta puede crearse un perfil de docente ya «aprobado» (y la 0008 lo convierte en un camino de cobro). Se probaron con 96 casos en un Postgres real, pero no contra tu proyecto de Supabase: revisalas antes.
- Sigue abierto: `tutor_profiles_select_public_when_approved` es por fila y expone todas las columnas de un docente aprobado, incluidas `contacto_verificacion`, `credential_url` y `mercadopago_account_id`. Cerrarlo exige mover esos datos a una tabla privada (o a una vista) y cambiar las consultas de la app.
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
