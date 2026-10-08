# Pruebas de la base de datos

Aplican las migraciones **reales** (`../migrations`) sobre un Postgres en memoria (PGlite) con lo
mínimo de Supabase (esquema `auth`, roles `anon`, `authenticated` y `service_role`) y comprueban,
rol por rol, qué se puede y qué no. No tocan ningún proyecto de Supabase.

```bash
npm run test:db              # todas
npm run test:db -- bookings  # solo las que tengan «bookings» en el nombre
```

| Archivo | Qué cubre |
|---|---|
| `rls-base.db.mjs` | Roles, ascenso a administrador, aprobación de docentes, disponibilidad, visibilidad, calificaciones |
| `bookings.db.mjs` | Reservas: crear, retener, vencer, cancelar y confirmar el pago; permisos de las funciones |
| `hardening.db.mjs` | Un caso por cada hallazgo de las revisiones de seguridad (perfiles de docente, pagos tardíos, tope de reservas, visibilidad) |
| `private-data.db.mjs` | Datos privados del docente (`tutor_private`) |
| `rls-matrix.db.mjs` | **Auditoría completa de la RLS**: 79 pruebas × 7 roles (visitante, alumno, otro alumno, docente, otro docente, administración, service role) sobre todas las tablas y operaciones, más «RLS activada en cada tabla» y quién puede ejecutar cada función |
| `upgrade-path.db.mjs` | Actualización de un proyecto **con datos**: aplica 0006 a 0010 sobre una base con las migraciones 0001 a 0005 y comprueba que no se pierde nada, que el archivo único (`npm run db:bundle`) se aplica de una vez y que, si falla, no queda nada a medias |
| `seed-compat.db.mjs` | Que las escrituras de `scripts/seed-demo.mjs` sigan siendo válidas con el esquema actual |
| `fresh-install.db.mjs` | Instalación desde cero: el archivo único `npm run db:bundle -- 1 <última>` (completo y compacto) sobre una base vacía deja un esquema IDÉNTICO (675 elementos comparados) al de todas las migraciones una por una, y la app anda encima |
| `payments.db.mjs` | Cimientos del cobro (0011): política de reembolsos con la tabla de casos límite compartida con TypeScript, comisión y su foto en cada reserva, confirmación de pago, cola de reembolsos, avisos idempotentes y credenciales de Mercado Pago |
| `checks.db.mjs` | Que las consultas de `supabase/checks` (diagnóstico y verificación para el SQL Editor) funcionen en cualquier estado de la base y digan lo correcto |

### La matriz de la RLS

Cada prueba de `rls-matrix.db.mjs` declara **quién puede** hacer algo; todos los demás tienen que quedar
afuera. Para comprobar que la matriz detecta un permiso abierto, se puede sabotear la base a propósito
(tiene que terminar con fallas):

```bash
MATRIX_SABOTAJE="create policy x on public.payments for select using (true);" npm run test:db -- matrix
```

Cuando una migración cambia un permiso a propósito, se actualiza la expectativa de la matriz en el mismo
cambio: así la regla queda escrita.

## Cómo agregar una prueba

1. Crear la base con `makeDb({ upTo: N })` y cargar los datos con `seed(db)` (`seed.mjs`).
2. Ejecutar las consultas con `as(db, "alumno" | "docente" | "admin" | "anon" | "service", fn)`: corren
   con el rol y el usuario de esa clave, así que la RLS aplica de verdad.
3. Comprobar con `expectOk`, `expectFail` o empujando `[ok, mensaje]` en la lista de resultados, y
   terminar con `report(resultados)`.

Toda regla que mueve dinero o protege datos tiene que tener acá un caso que la rompa a propósito.
Las pruebas no reemplazan probar las migraciones en un proyecto de Supabase de prueba antes de
aplicarlas en el real.
