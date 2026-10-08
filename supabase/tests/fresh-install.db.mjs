// Instalación desde cero: un proyecto de Supabase NUEVO y vacío recibe el archivo único
// (`npm run db:bundle -- 1 10`, con y sin comentarios). El resultado tiene que ser EXACTAMENTE el
// mismo que aplicar las diez migraciones una por una, y la app tiene que andar encima.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { makeDb, as, ids, report } from "./harness.mjs";
import { seed } from "./seed.mjs";

const r = [];
const root = fileURLToPath(new URL("../..", import.meta.url));
// Siempre contra la ÚLTIMA migración: si se agrega una, esta prueba la cubre sin tocar nada.
const LAST = Math.max(...fs.readdirSync(new URL("../migrations/", import.meta.url)).map((f) => Number(f.slice(0, 4))));
const N = String(LAST).padStart(4, "0");
const q = (db, sql) => db.query(sql);
const leer = (ruta) => fs.readFileSync(fileURLToPath(new URL(ruta, import.meta.url)), "utf8");

function generar(...args) {
  const g = spawnSync(process.execPath, ["scripts/bundle-migrations.mjs", ...args], { cwd: root, encoding: "utf8" });
  return g.status === 0;
}
r.push([generar("1", String(LAST)), `npm run db:bundle -- 1 ${LAST} genera el archivo completo`]);
r.push([generar("1", String(LAST), "--compacto"), `npm run db:bundle -- 1 ${LAST} --compacto genera la versión sin comentarios`]);
const COMPLETO = leer(`../aplicar-0001-a-${N}.sql`);
const COMPACTO = leer(`../aplicar-0001-a-${N}-compacto.sql`);
r.push([COMPACTO.length < COMPLETO.length * 0.75, `la versión compacta es más corta (${COMPACTO.length} contra ${COMPLETO.length} caracteres)`]);
const comentarios = COMPACTO.split("begin;")[1].split("\n").filter((l) => l.trim().startsWith("--") && !l.startsWith("-- ====="));
r.push([comentarios.length === 0, "la compacta solo conserva los títulos de cada migración como comentarios"]);

// Huella del esquema: todo lo que define lo que la base permite y lo que no.
const HUELLA = `
  select 'columna' as tipo, table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable as dato
    from information_schema.columns where table_schema = 'public'
  union all select 'política', tablename || ' / ' || policyname || ' / ' || cmd || ' / ' || coalesce(qual, '') || ' / ' || coalesce(with_check, '')
    from pg_policies where schemaname = 'public'
  union all select 'trigger', c.relname || ' / ' || t.tgname
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal and n.nspname in ('public', 'auth')
  -- El código de cada función se compara sin saltos de línea de Windows ni líneas de comentario:
  -- la versión compacta saca los comentarios y el disco puede tener \\r\\n.
  union all select 'función', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') '
      || md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\\r', ''), E'(^|\\n)[ \\t]*--[^\\n]*', '', 'g'), E'\\n+', E'\\n', 'g'))
      || ' ' || p.prosecdef
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
  union all select 'índice', indexname || ' ' || indexdef from pg_indexes where schemaname = 'public'
  union all select 'restricción', conrelid::regclass || ' ' || conname || ' ' || pg_get_constraintdef(oid)
    from pg_constraint where connamespace = 'public'::regnamespace
  union all select 'RLS', relname || ' ' || relrowsecurity from pg_class
    where relnamespace = 'public'::regnamespace and relkind = 'r'
  union all select 'permiso de tabla', table_name || ' ' || grantee || ' ' || privilege_type
    from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role')
  union all select 'permiso de función', p.proname || ' ' || r.rolname || ' ' || has_function_privilege(r.rolname, p.oid, 'execute')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace, pg_roles r
    where n.nspname = 'public' and r.rolname in ('anon', 'authenticated', 'service_role')
  union all select 'materia', name from public.subjects
  order by 1, 2`;

async function huella(db) {
  return (await q(db, HUELLA)).rows.map((x) => `${x.tipo}|${x.dato}`);
}

// Camino de referencia: las diez migraciones, una por una.
const referencia = await makeDb();
const huellaReferencia = await huella(referencia);

for (const [nombre, sql] of [["completo", COMPLETO], ["compacto", COMPACTO]]) {
  const db = await makeDb({ upTo: 0 });
  let ok = true;
  try {
    // El arnés no tiene pgcrypto (gen_random_uuid es nativo); en Supabase la extensión existe.
    await db.exec(sql.replace(/create extension if not exists "pgcrypto";/i, "-- pgcrypto omitido en el arnés"));
  } catch (e) {
    ok = false;
    console.log(e.message);
  }
  r.push([ok, `el archivo ${nombre} se aplica de una vez sobre una base vacía`]);
  if (!ok) continue;

  const h = await huella(db);
  const distintas = [...h.filter((x) => !huellaReferencia.includes(x)), ...huellaReferencia.filter((x) => !h.includes(x))];
  r.push([distintas.length === 0, `...y el esquema es IDÉNTICO al de todas las migraciones una por una (${h.length} elementos comparados)${distintas.length ? " · difieren: " + distintas.slice(0, 3).join(" ; ") : ""}`]);

  // Diagnóstico y verificación sobre la instalación nueva.
  const diag = (await db.exec(leer("../checks/1-diagnostico.sql"))).at(-1).rows;
  r.push([/nada: están todas/.test(diag.at(-1).migracion), `el diagnóstico dice que están todas (${nombre})`]);
  const verif = (await db.exec(leer("../checks/2-verificacion.sql"))).at(-1).rows;
  r.push([verif.filter((f) => f.orden <= 15).every((f) => f.resultado === "OK"), `la verificación da OK en las filas 1 a 15 (${nombre})`]);
}

// --- La app anda sobre la instalación nueva (se usa el archivo compacto) ---------------------------------
{
  const db = await makeDb({ upTo: 0 });
  await db.exec(COMPACTO.replace(/create extension if not exists "pgcrypto";/i, ""));
  await seed(db);
  const materias = (await q(db, "select count(*)::int as n from public.subjects")).rows[0].n;
  r.push([materias >= 10, `el catálogo de materias viene cargado (${materias})`]);

  const priv = (await q(db, "select count(*)::int as n from public.tutor_private")).rows[0].n;
  r.push([priv === 2, "los docentes que se registran nacen con su fila privada"]);

  let reserva;
  await as(db, "alumno", async () => {
    reserva = (await q(db, "select public.create_booking('51000000-0000-0000-0000-000000000001') as id")).rows[0].id;
  });
  r.push([!!reserva, "un alumno reserva un horario libre"]);
  await as(db, "alumno", async () => {
    await q(db, `select public.cancel_booking('${reserva}')`);
  });
  const estado = (await q(db, `select status from public.bookings where id = '${reserva}'`)).rows[0].status;
  r.push([estado === "cancelada", "...y la cancela"]);
  await as(db, "anon", async () => {
    try {
      await q(db, "select * from public.tutor_private");
      r.push([false, "un visitante no debería leer tutor_private"]);
    } catch {
      r.push([true, "un visitante no puede leer los datos privados de un docente"]);
    }
  });
  await as(db, "alumno2", async () => {
    try {
      await q(db, `update public.profiles set role = 'administrador' where id = '${ids.alumno2}'`);
      r.push([false, "no debería poder ascenderse a administrador"]);
    } catch {
      r.push([true, "nadie puede ascenderse a administrador desde la API"]);
    }
  });
}

report(r);
