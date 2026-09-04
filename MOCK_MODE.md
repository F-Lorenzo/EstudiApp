# Modo mock (sin base de datos)

La app corre hoy **sin Supabase**: todo el estado vive en memoria en
`src/lib/mock/data.ts`, para poder hacer una demo sin depender de tener
un proyecto de Supabase configurado.

## Cómo correrla

```bash
npm run dev
```

No hace falta `.env.local` ni ninguna variable de entorno.

**Importante**: los datos son en memoria del proceso de Node. Se
resetean cada vez que reiniciás `npm run dev` (o cuando Vercel recicla
la instancia serverless en producción — este modo es para demos
locales, no para producción).

## Credenciales de demo

Todas las cuentas usan la misma contraseña: **`Demo1234!`**

| Email | Rol | Notas |
|---|---|---|
| maria.gonzalez.demo@estudiapp.test | Docente | Aprobada — Matemática, Física |
| juan.perez.demo@estudiapp.test | Docente | Aprobada — Programación, Inglés |
| lucia.fernandez.demo@estudiapp.test | Docente | Aprobada — Lengua, Historia |
| pedro.diaz.demo@estudiapp.test | Docente | **Pendiente** de aprobación (para mostrar el flujo admin) |
| sofia.martinez.demo@estudiapp.test | Alumno | Tiene 1 clase completada en el historial |
| tomas.rodriguez.demo@estudiapp.test | Alumno | Tiene 1 clase próxima confirmada |
| admin.demo@estudiapp.test | Administrador | Panel de aprobación y métricas |

También podés crear cuentas nuevas desde `/registro/alumno` o
`/registro/docente` — quedan en memoria hasta que reiniciás el server.

## Qué es y qué no es "real" en este modo

- Login, registro, roles, catálogo, perfiles, aprobación/rechazo de
  docentes y métricas: funcionan de verdad sobre los datos en memoria.
- Recuperar/actualizar contraseña: simulados (no hay proveedor de
  email conectado).
- No hay persistencia real ni seguridad de verdad (las contraseñas se
  guardan en texto plano en el array — es solo para la demo).

## Editar los datos de la demo

Todo está en `src/lib/mock/data.ts` — son arrays de objetos JS
comunes (`PROFILES`, `TUTOR_PROFILES`, `AVAILABILITY_SLOTS`,
`BOOKINGS`, `RATINGS`, etc.). Cambiar nombres, tarifas, materias o
agregar más filas ahí alcanza.

## Cómo volver a la versión con Supabase real

Este modo se agregó en un commit autocontenido sobre la versión que sí
usa Supabase (con sus migraciones en `supabase/migrations/` y el seed
real en `scripts/seed-demo.mjs`, que siguen intactos). Para volver:

```bash
git log --oneline --grep="modo mock"
git revert <ese-commit>
```

Eso restaura los clientes de Supabase (`src/lib/supabase/`), las
consultas reales y el middleware con `@supabase/ssr`, sin perder nada
del trabajo hecho después. También podés simplemente borrar
`src/lib/mock/` y `MOCK_MODE.md`, pero vas a tener que revertir a mano
cada archivo que quedó apuntando a `@/lib/mock/*` — `git revert` es más
directo.
