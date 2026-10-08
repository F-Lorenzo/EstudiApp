# Fase 0 — Lo que falta para cerrarla

Todo lo que se podía hacer en el código está hecho y en la rama principal. Lo que queda es configurar
**tu proyecto de Supabase** y **tu proyecto de Vercel**, y recorrer la app a mano. Son unos 60 a 90
minutos. Seguí los pasos en orden: cada uno dice qué tenés que ver para pasar al siguiente.

**Necesitás:** acceso al dashboard de Supabase, al de Vercel y una terminal en la carpeta del repo
(`EstudiApp-integrado`).

> **Regla de oro:** las claves (anon, service role) se pegan solo en los dashboards o en tu
> `.env.local`. Nunca en el chat, en Trello ni en el repo.

---

## 0. ¿Proyecto real o de prueba?

Si tu proyecto de Supabase ya tiene **usuarios reales**, hacé los pasos 1 a 4 primero en un proyecto
de prueba (Supabase → New project, por ejemplo `estudiapp-pruebas`, gratis). Si todo da OK, repetí
los mismos pasos en el real. Si el proyecto solo tiene datos de prueba, podés ir directo.

---

## 1. Diagnóstico: ¿qué tiene hoy tu base? (2 min)

1. Supabase → tu proyecto → **SQL Editor** → **New query**.
2. Pegá el contenido de `supabase/checks/1-diagnostico.sql` y apretá **Run**.
3. Te muestra qué migraciones (0001 a 0011) tiene y, en la **última fila, qué hacer**:

| La última fila dice… | Hacé esto |
|---|---|
| «aplicá supabase/aplicar-0006-a-0010.sql…» | Seguí con el paso 2. Es el caso esperado. |
| «proyecto vacío…» | **Instalación desde cero**: corré `npm run db:bundle -- 1 11`, copiá todo `supabase/aplicar-0001-a-0011.sql` (o `npm run db:bundle -- 1 11 --compacto` para la versión sin comentarios), pegalo en el SQL Editor y Run. Con eso quedan las diez migraciones y **saltás directo al paso 4** (verificación). |
| «faltan algunas de 0001 a 0005…» | Aplicá solo las de 0001 a 0005 que dicen NO, en orden. Volvé a correr el diagnóstico. |
| «nada: están todas…» | Saltá al paso 4. |
| «estado mezclado…» | **No sigas.** Mandame el resultado completo del diagnóstico. |

Este archivo solo lee: no cambia nada.

---

## 2. Controles previos (5 min)

En la terminal, dentro del repo:

```bash
npm run db:bundle
```

Genera `supabase/aplicar-0006-a-0010.sql`. En su encabezado hay dos consultas. Corré cada una en el
SQL Editor:

1. **Franjas duplicadas.** Tiene que devolver **0 filas**. Si devuelve alguna, borrá a mano las
   repetidas (dejá una por docente y hora). Si no lo hacés, la migración 0007 se corta con un aviso
   y no se aplica nada.
2. **Reservas «confirmada» o «completada» sin pago aprobado.** Antes de la 0008 un alumno podía
   confirmarse una reserva sin pagar. Como todavía no hay cobros reales, cualquier fila que aparezca
   es de prueba o un intento de abuso. No frena nada: se resuelve en el paso 4.

---

## 3. Aplicar las migraciones 0006 a 0010 (5 min)

1. Abrí `supabase/aplicar-0006-a-0010.sql`, copiá **todo** el contenido y pegalo en una consulta
   nueva del SQL Editor.
2. **Run.** Lo esperado es «Success. No rows returned».
3. Si aparece un error: **no quedó nada a medias** (corre en una sola transacción). Copiá el mensaje
   de error y mandámelo. No intentes aplicar las migraciones de a una.

---

## 4. Verificación (2 min)

Pegá `supabase/checks/2-verificacion.sql` en el SQL Editor y apretá **Run**. Son 14 filas:

- Las filas **1 a 11** tienen que decir **OK**. Si alguna dice FALLA, no sigas y mandame el resultado.
- Las filas **12 a 14** pueden decir **REVISAR**:

**Fila 12 · reservas confirmadas sin pago.** Para verlas, corré la consulta 2 del paso 2. Como no
hubo cobros reales, lo recomendado es cancelarlas:

```sql
update public.bookings
set status = 'cancelada', cancellation_reason = 'Sin pago registrado'
where status in ('confirmada', 'completada')
  and not exists (select 1 from public.payments p where p.booking_id = bookings.id and p.status = 'aprobado');
```

**Fila 13 · no hay administración.** Se resuelve en el paso 5.

**Fila 14 · cuentas del seed de demo viejo.** Su contraseña está publicada en el repo, así que hay
que borrarlas. Borrar la cuenta borra en cascada su perfil, sus reservas y demás:

```sql
delete from auth.users where email like '%.demo@estudiapp.test';
```

Volvé a correr la verificación hasta que las filas 1 a 12 y la 14 digan OK.

---

## 5. Tu cuenta de administración (5 min)

1. Registrate en la app como alumno (`/registro/alumno`) con tu email y confirmalo. Si todavía no
   configuraste los emails (paso 6), confirmalo a mano desde el SQL Editor:

   ```sql
   update auth.users set email_confirmed_at = now() where email = 'TU_EMAIL';
   ```

2. Pasala a administración:

   ```sql
   update public.profiles set role = 'administrador'
   where id = (select id from auth.users where email = 'TU_EMAIL');
   ```

3. Cerrá sesión y volvé a entrar: tenés que caer en `/admin/docentes/pendientes`.

---

## 6. Autenticación de Supabase (10 min)

**Authentication → URL Configuration**

- **Site URL:** el dominio de producción (por ejemplo `https://tu-proyecto.vercel.app`). Los links
  de los emails apuntan acá. Si por ahora solo vas a probar en tu máquina, poné
  `http://localhost:3000` y cambialo antes de lanzar.
- **Redirect URLs:** agregá `http://localhost:3000/**`, `https://TU-DOMINIO/**` y, para las vistas
  previas de Vercel, `https://*-TU-EQUIPO.vercel.app/**`.

**Authentication → Emails → Templates.** La app espera que los links pasen por `/auth/confirm`.
Reemplazá el cuerpo de estas dos plantillas:

*Confirm signup* — asunto: «Confirmá tu cuenta de EstudiApp»

```html
<h2>Ya casi estás</h2>
<p>Confirmá tu email para empezar a usar EstudiApp.</p>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">Confirmar mi cuenta</a></p>
<p>Si no creaste una cuenta, ignorá este mensaje.</p>
```

*Reset password* — asunto: «Elegí una nueva contraseña»

```html
<h2>Recuperá tu cuenta</h2>
<p>Pediste cambiar tu contraseña de EstudiApp.</p>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery">Elegir una nueva contraseña</a></p>
<p>Si no lo pediste, ignorá este mensaje: tu contraseña sigue igual.</p>
```

> El servicio de email que trae Supabase sirve para probar, pero manda **muy pocos emails por
> hora**. Si te quedás sin envíos, confirmá cuentas a mano con la consulta del paso 5. Para el
> lanzamiento hay que configurar un SMTP propio (es una de las decisiones de la Fase 1).

---

## 7. Vercel (10 min)

**Settings → Environment Variables.** Los valores están en Supabase → Project Settings → API.

| Variable | Valor | Entornos |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | La «Project URL» | Production, Preview, Development |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | La clave pública *anon* (en proyectos nuevos puede figurar como *publishable*) | Production, Preview, Development |
| `NEXT_PUBLIC_SITE_URL` | El dominio de producción, por ejemplo `https://tu-proyecto.vercel.app` | Production |

**No cargues** `SUPABASE_SERVICE_ROLE_KEY` ni `ALLOW_SIMULATED_PAYMENTS` en Vercel: hoy no hacen
falta (recién en la Fase 1, para el webhook de pago), y cuantos menos lugares tengan esa clave,
mejor.

**Settings → Git → Production Branch:** tiene que ser la rama principal del repo
(`claude/google-docs-link-review-19lx7g`). Si figura otra, cambiala.

Después: **Deployments → el último de producción → Redeploy**, para que tome las variables.

---

## 8. Tu máquina (opcional, 5 min)

Solo si querés probar también en local, incluido el **pago simulado**, que no existe en Vercel:

```bash
cp .env.local.example .env.local
```

Completá `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Para el pago simulado agregá
`SUPABASE_SERVICE_ROLE_KEY` (Project Settings → API → service_role; **solo en este archivo**) y
`ALLOW_SIMULATED_PAYMENTS=true`. Después:

```bash
npm install
npm run dev
```

La app queda en http://localhost:3000.

---

## 9. Recorrido a mano (30 a 40 min)

Hacelo en la URL de Vercel o en tu máquina. Marcá cada punto; si uno falla, anotá el número, qué
hiciste y qué viste (una captura ayuda).

**Visitante sin sesión**
- [ ] 1. La Home carga y muestra docentes (si ya hay alguno aprobado).
- [ ] 2. `/docentes`: el buscador y los filtros responden.
- [ ] 3. `/alumno` sin sesión te lleva a `/login`.

**Alumno**
- [ ] 4. Registro en `/registro/alumno` → llega el email → el link te deja con la sesión iniciada.
- [ ] 5. Cerrar sesión y volver a entrar.
- [ ] 6. «¿Olvidaste tu contraseña?» → llega el email → el link abre «Actualizar contraseña» → la
      cambiás → entrás con la nueva.
- [ ] 7. `/alumno/perfil`: cambiar el nombre se guarda.

**Docente**
- [ ] 8. Registro en `/registro/docente` con otro email → confirmar.
- [ ] 9. Completar el perfil en 3 pasos (tarifa, por ejemplo, 14500) → queda «pendiente de revisión».

**Administración** (con tu cuenta del paso 5)
- [ ] 10. `/admin/docentes/pendientes` muestra al docente; la ficha muestra su **contacto y su
      respaldo**.
- [ ] 11. Aprobarlo. Pasa a «Docentes activos» y aparece en `/docentes`.
- [ ] 12. (Opcional) Con un tercer docente: rechazarlo con un motivo → el docente ve el motivo,
      corrige el perfil y vuelve a la cola.

**Disponibilidad y reservas**
- [ ] 13. Con el docente aprobado: `/docente/disponibilidad` → abrir 3 franjas de la semana próxima
      → Guardar.
- [ ] 14. Con el alumno: perfil del docente → elegir un horario → «Reservar y continuar» → pantalla
      de pago con la cuenta regresiva de 15 minutos.
- [ ] 15. «Cancelar reserva» pide confirmación → la reserva queda cancelada y el horario vuelve a
      estar libre en el perfil del docente.
- [ ] 16. Reservar otro horario. En Vercel el botón de Mercado Pago aparece deshabilitado (es lo
      esperado). En tu máquina con el pago simulado: «Simular pago aprobado» → «Reserva confirmada»
      → aparece en «Próximas clases» del alumno y en el inicio del docente.

La privacidad de los datos (que nadie pueda leer el contacto ni la cuenta de cobro de un docente
desde la API) no se puede probar desde la pantalla. La cubren las filas 2 y 3 de la verificación
del paso 4 y las pruebas automáticas del CI.

---

## 10. Cerrar la fase

1. Mandame en el chat:
   - el resultado de `2-verificacion.sql`, que no tiene claves;
   - qué puntos del recorrido dieron OK y cuáles no.
2. En Trello, pasá a **Hecho** las tarjetas de **Revision** que hayas validado en el recorrido.
3. Con eso doy por cerrada la Fase 0 en `ROADMAP.md` y en Trello y arrancamos la Fase 1.

**Para no frenar la Fase 1, conviene ir definiendo con el cliente:**
- la política de cancelación y reembolso (plazos y porcentajes);
- la comisión de la plataforma;
- la cuenta de Mercado Pago de la plataforma (empezamos con las credenciales de prueba);
- el proveedor de email (SMTP propio).
