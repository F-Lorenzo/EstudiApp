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

## Cómo agregar una prueba

1. Crear la base con `makeDb({ upTo: N })` y cargar los datos con `seed(db)` (`seed.mjs`).
2. Ejecutar las consultas con `as(db, "alumno" | "docente" | "admin" | "anon" | "service", fn)`: corren
   con el rol y el usuario de esa clave, así que la RLS aplica de verdad.
3. Comprobar con `expectOk`, `expectFail` o empujando `[ok, mensaje]` en la lista de resultados, y
   terminar con `report(resultados)`.

Toda regla que mueve dinero o protege datos tiene que tener acá un caso que la rompa a propósito.
Las pruebas no reemplazan probar las migraciones en un proyecto de Supabase de prueba antes de
aplicarlas en el real.
