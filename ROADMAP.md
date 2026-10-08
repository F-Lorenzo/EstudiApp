# EstudiApp — Roadmap por fases

El proyecto se construye en fases, ordenadas por **prioridad de construcción**: primero lo que
sostiene al resto, después lo que se apoya en eso. Una fase se cierra cuando se cumple su
**criterio de salida**; no se empieza la siguiente con huecos de seguridad o sin pruebas en la
anterior. El tablero de Trello (`EstudiApp — MVP`) marca cada tarjeta pendiente con su fase.

Estado al día de hoy: el diseño, la cuenta (alumno, docente, administración), el catálogo, la
disponibilidad y las **reservas** (sin cobro real) están construidos. Lo que no existe todavía es
el dinero real, la videollamada, los emails y las pruebas automáticas.

## Cómo se decide el orden

1. **Seguridad y verificación primero.** Cada fase siguiente agrega datos sensibles (cobros,
   cuentas de Mercado Pago, salas de video). Si la base tiene huecos, se agrandan con cada fase.
2. **Dependencias.** No se puede reembolsar sin cobrar, ni dar acceso a una sala sin una reserva
   paga, ni calificar sin una clase dada.
3. **Valor para el negocio.** Dentro de lo que no depende de otra cosa, primero lo que acerca el
   primer ingreso real.
4. **Decisiones del cliente a tiempo.** Cada fase lista lo que hay que decidir *antes* de empezar,
   para no frenar la construcción.

---

## Fase 0 — Bases sólidas  ← en curso

Objetivo: que lo que ya está construido sea seguro, verificable y se pueda desplegar, antes de
sumar dinero real.

| # | Trabajo | Tarjetas de Trello |
|---|---|---|
| 0.1 | **Red de seguridad automática**: pruebas unitarias, pruebas de la base de datos con RLS (en un Postgres real) y CI en GitHub (tipos, lint, pruebas, build) en cada cambio. | Pruebas automáticas mínimas · Auditar la RLS completa con pruebas por rol |
| 0.2 | **Datos privados del docente fuera de la tabla pública** (`tutor_private`): contacto, credencial y, más adelante, la cuenta y los tokens de Mercado Pago. Es prerrequisito de la Fase 1. | Cerrar la exposición pública de datos privados del docente |
| 0.3 | **Seed de demo seguro**: contraseña aleatoria por ejecución, se niega a correr sin confirmación explícita y es compatible con las reservas. | Demo: la contraseña de las cuentas del seed es pública |
| 0.4 | **Base real en marcha** *(a cargo de quien administra Supabase y Vercel)*: aplicar las migraciones 0006 a 0010 **en orden**, cargar las variables de entorno, configurar los emails de Supabase y recorrer a mano los flujos con sesión. | Aplicar la migración 0006 · Setup de Supabase · Variables en Vercel y plantillas de email · Probar con Supabase real · Configuración de despliegue en Vercel |

**Criterio de salida:** el CI está en verde en cada cambio; las migraciones están aplicadas en un
proyecto de Supabase real sin errores; alumno, docente y administración recorrieron sus flujos
contra esa base; no queda ningún dato privado legible desde la clave pública.

**Avance (lo que se puede hacer sin tocar Supabase ni Vercel ya está hecho):**

- ✅ 0.1 Pruebas: 109 unitarias (incluye las acciones del servidor con Supabase simulado) y 250
  comprobaciones de base de datos, entre ellas la **matriz completa de la RLS** (497 intentos por
  rol) y la **actualización sobre datos existentes**. CI de GitHub con tipos, lint, pruebas, auditoría
  de dependencias y build.
- ✅ 0.2 `tutor_private` (migración 0010).
- ✅ 0.3 Seed seguro y compatible con las reservas.
- ✅ Seguridad de dependencias: Next.js 16.4.0 (la 16.3.2 tenía vulnerabilidades críticas).
- ✅ Un solo archivo para aplicar las migraciones (`npm run db:bundle`), en una transacción y con
  controles previos.
- ⏳ 0.4 Pendiente de quien administra Supabase y Vercel (aplicar, variables de entorno, emails y
  recorrido a mano). Es lo único que impide cerrar la fase.

**Decisiones previas:** ninguna.

---

## Fase 1 — Cobrar de verdad (núcleo del negocio)

Objetivo: una clase reservada se paga con Mercado Pago, el pago confirma la reserva de forma
segura y se puede devolver.

1. **Política de cancelación y reembolso** (decisión del cliente: plazos y porcentajes). Bloquea
   los reembolsos y el texto legal.
2. **Checkout de Mercado Pago** y manejo de pago rechazado o fallido. El horario se retiene los
   mismos 15 minutos.
3. **Webhook** con verificación de firma, idempotencia de eventos y tabla de eventos. Llama a
   `confirm_booking_payment`; ante cualquier error del pago, reembolsa automáticamente.
4. **Cuenta de Mercado Pago del docente** (OAuth) y **split de pago** (comisión de la plataforma).
5. **Reembolso** y cancelación con reembolso según la política.
6. **Emails transaccionales mínimos**: reserva confirmada (alumno), nueva reserva (docente),
   pago recibido.
7. Retirar el pago simulado de cualquier entorno que no sea desarrollo.

**Criterio de salida:** con credenciales de prueba de Mercado Pago, una reserva se paga, la
confirma el webhook, el docente queda acreditado con la comisión descontada y una cancelación
dentro del plazo devuelve el dinero. Probado además con pagos duplicados, tardíos y rechazados.

**Decisiones previas:** política de cancelación y reembolso; comisión de la plataforma; cuenta de
Mercado Pago de la plataforma (credenciales de prueba y producción); proveedor de email.

---

## Fase 2 — La clase: videollamada y reputación

Objetivo: alumno y docente se encuentran en una sala real y la clase deja una calificación.

1. **Daily.co**: sala creada para cada reserva confirmada.
2. **Control de acceso**: solo los dos participantes, solo en el horario de la clase.
3. Controles básicos de video y audio.
4. **Regla de «completada»** apoyada en la asistencia a la sala (hoy se completa solo por horario).
5. **Calificación post-clase** (formulario real, autor visible) y reseñas con fecha relativa.
6. El docente ve el **nombre de sus alumnos** (dashboard y sala).

**Criterio de salida:** una clase real de punta a punta entre dos cuentas, con calificación
posterior que actualiza el promedio del docente.

**Decisiones previas:** cuenta de Daily.co; política de privacidad sobre grabaciones (se asume
que no se graba); qué datos del alumno ve el docente.

---

## Fase 3 — Operación y confianza

Objetivo: que el equipo pueda operar el producto sin tocar la base de datos.

1. **Emails restantes**: recordatorio de clase, aprobación o rechazo del perfil docente.
2. **Administración**: lista de rechazados con motivo y reapertura (con historial de decisiones),
   editor de banners e imágenes, métricas con datos reales.
3. **Docente**: estado de la cuenta de Mercado Pago, historial y cobros.
4. **Modelo del docente ampliado**: años de experiencia, universidad, cantidad de reseñas.
5. Auditoría de acciones de administración.

**Criterio de salida:** alta, aprobación, soporte y seguimiento de cobros se resuelven desde la
interfaz de administración.

**Decisiones previas:** campos finales del registro de docentes (reunión con el cliente).

---

## Fase 4 — Calidad y lanzamiento

Objetivo: salir a producción con confianza.

1. **Revisión responsive y de accesibilidad** de todas las pantallas con sesión; movimiento
   reducido.
2. **Búsqueda sin tildes en SQL** (`unaccent`) y paginación del catálogo.
3. **Rate limiting y anti-bots** en login, registro, recuperación y reservas.
4. **Pruebas de punta a punta** del recorrido completo (registro → aprobación → búsqueda →
   reserva → pago → clase → calificación).
5. **Textos legales finales** (términos, privacidad, cancelación, condiciones de ingreso) y marca.
6. Quitar `noindex`, quitar los avisos de «vista de muestra», verificar la firma del webhook en
   todos los entornos y **desplegar a producción**.

**Criterio de salida:** producción desplegada, checklist de lanzamiento completo y un recorrido
real de punta a punta con dinero real de bajo monto.

**Decisiones previas:** textos legales revisados por un profesional; dominio; fecha de lanzamiento.

---

## Cómo se trabaja cada fase

- Una rama por trabajo (`feat/...`), cambios chicos y verificables, y fusión a la rama principal
  solo con el CI en verde.
- Toda regla que mueve dinero o protege datos vive en la base (funciones y RLS) **y** tiene una
  prueba en `supabase/tests`.
- Las migraciones no se editan una vez aplicadas en un proyecto real: se agrega una nueva.
- Al cerrar cada fase se actualizan este archivo, `CLAUDE.md` y Trello.
