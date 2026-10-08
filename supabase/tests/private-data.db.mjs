// Migración 0010: los datos privados del docente salen de la tabla pública.
import { makeDb, applyMigration, as, ids, expectFail, expectOk, report } from "./harness.mjs";
import { seed } from "./seed.mjs";

const r = [];
const q = (db, sql) => db.query(sql);

// --- Antes de la 0010: el problema que se corrige -----------------------------------------------
const db = await makeDb({ upTo: 9 });
await seed(db);
await db.exec(`
  update public.tutor_profiles
  set contacto_verificacion = '+54 9 11 5555-0001',
      credential_url = 'https://ejemplo.test/titulo.pdf',
      mercadopago_account_id = 'mp-cuenta-123'
  where id = '${ids.docente}';
  update public.tutor_profiles
  set contacto_verificacion = 'pendiente@ejemplo.test'
  where id = '${ids.docente2}';
`);

await as(db, "anon", async () => {
  const x = await q(db, `select contacto_verificacion, mercadopago_account_id from public.tutor_profiles where id = '${ids.docente}'`);
  r.push([
    x.rows.length === 1 && x.rows[0].mercadopago_account_id === "mp-cuenta-123",
    "ANTES de la 0010 un visitante lee la cuenta de Mercado Pago y el contacto de un docente aprobado (el problema)",
  ]);
});

await applyMigration(db, 10);

// --- Los datos se copiaron y las columnas ya no están en la tabla pública --------------------------
{
  const cols = (await q(db, `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'tutor_profiles'`)).rows.map((x) => x.column_name);
  r.push([
    !cols.includes("contacto_verificacion") && !cols.includes("credential_url") && !cols.includes("mercadopago_account_id"),
    "tutor_profiles ya no tiene contacto, respaldo ni cuenta de Mercado Pago",
  ]);
  const p = (await q(db, `select * from public.tutor_private where id = '${ids.docente}'`)).rows[0];
  r.push([
    p?.contacto_verificacion === "+54 9 11 5555-0001" && p.credential_url === "https://ejemplo.test/titulo.pdf" && p.mercadopago_account_id === "mp-cuenta-123",
    "los datos del docente se copiaron a tutor_private",
  ]);
  const total = (await q(db, `select (select count(*) from public.tutor_private)::int as priv, (select count(*) from public.tutor_profiles)::int as pub`)).rows[0];
  r.push([total.priv === total.pub, `hay una fila privada por cada docente (${total.priv})`]);
}

// --- Quién puede leer la tabla privada -----------------------------------------------------------------
await as(db, "anon", () => expectFail("un visitante NO puede leer tutor_private (ni siquiera tiene el permiso)", q(db, `select * from public.tutor_private`), r));
await as(db, "anon", async () => {
  const x = await q(db, `select * from public.tutor_profiles where id = '${ids.docente}'`);
  const columnas = Object.keys(x.rows[0] ?? {});
  r.push([
    x.rows.length === 1 && !columnas.some((c) => ["contacto_verificacion", "credential_url", "mercadopago_account_id"].includes(c)),
    "el perfil público del docente sigue siendo legible, sin datos privados",
  ]);
});
await as(db, "alumno", async () => {
  const x = await q(db, `select id from public.tutor_private`);
  r.push([x.rows.length === 0, "un alumno no ve ninguna fila privada"]);
});
await as(db, "docente2", async () => {
  const x = await q(db, `select id from public.tutor_private where id = '${ids.docente}'`);
  r.push([x.rows.length === 0, "otro docente NO ve los datos privados de este docente"]);
});
await as(db, "docente", async () => {
  const x = await q(db, `select mercadopago_account_id, contacto_verificacion from public.tutor_private`);
  r.push([x.rows.length === 1 && x.rows[0].mercadopago_account_id === "mp-cuenta-123", "el docente ve SUS datos privados"]);
});
await as(db, "admin", async () => {
  const x = await q(db, `select id from public.tutor_private`);
  r.push([x.rows.length >= 2, "la administración ve los datos privados de todos"]);
});

// --- Quién puede escribirla ------------------------------------------------------------------------------
await as(db, "docente", () => expectOk("el docente actualiza su contacto y su respaldo",
  q(db, `insert into public.tutor_private (id, contacto_verificacion, credential_url) values ('${ids.docente}', '+54 9 11 0000-0000', 'https://ejemplo.test/nuevo.pdf')
         on conflict (id) do update set contacto_verificacion = excluded.contacto_verificacion, credential_url = excluded.credential_url`), r));
{
  const p = (await q(db, `select contacto_verificacion, mercadopago_account_id from public.tutor_private where id = '${ids.docente}'`)).rows[0];
  r.push([p.contacto_verificacion === "+54 9 11 0000-0000" && p.mercadopago_account_id === "mp-cuenta-123", "...y la cuenta de Mercado Pago no se tocó"]);
}
await as(db, "docente", () => expectFail("el docente NO puede cambiar su cuenta de Mercado Pago (update)",
  q(db, `update public.tutor_private set mercadopago_account_id = 'cuenta-del-atacante' where id = '${ids.docente}'`), r));
await as(db, "docente", () => expectFail("el docente NO puede cambiarla con un upsert",
  q(db, `insert into public.tutor_private (id, mercadopago_account_id) values ('${ids.docente}', 'cuenta-del-atacante')
         on conflict (id) do update set mercadopago_account_id = excluded.mercadopago_account_id`), r));
await as(db, "docente", () => expectFail("el docente NO puede escribir los datos de otro docente",
  q(db, `insert into public.tutor_private (id, contacto_verificacion) values ('${ids.docente2}', 'pisado')
         on conflict (id) do update set contacto_verificacion = excluded.contacto_verificacion`), r));
await as(db, "alumno2", () => expectFail("un alumno NO puede crearse una fila privada (no es docente)",
  q(db, `insert into public.tutor_private (id, contacto_verificacion) values ('${ids.alumno2}', 'x')`), r));
await as(db, "service", () => expectOk("el backend (service role) SI fija la cuenta de Mercado Pago",
  q(db, `update public.tutor_private set mercadopago_account_id = 'mp-nueva' where id = '${ids.docente}'`), r));
await as(db, "docente", async () => {
  const x = await q(db, `delete from public.tutor_private where id = '${ids.docente}' returning id`);
  r.push([x.rows.length === 0, "el docente NO puede borrar su fila privada (no hay política de DELETE)"]);
});

// --- Las guardas de 0006 y 0009 siguen funcionando después de reemplazarlas -------------------------------------
await as(db, "docente2", () => expectFail("un docente pendiente NO puede aprobarse a sí mismo",
  q(db, `update public.tutor_profiles set verification_status = 'aprobado' where id = '${ids.docente2}'`), r));
await as(db, "docente", () => expectFail("un docente NO puede cambiar su calificación",
  q(db, `update public.tutor_profiles set rating_promedio = 5 where id = '${ids.docente}'`), r));
await as(db, "docente", () => expectOk("un docente SI edita su biografía y su tarifa",
  q(db, `update public.tutor_profiles set bio = 'Nueva bio', tarifa_por_clase = 9000 where id = '${ids.docente}'`), r));
await as(db, "alumno2", () => expectFail("un alumno sigue sin poder crearse un perfil de docente aprobado",
  q(db, `insert into public.tutor_profiles (id, verification_status) values ('${ids.alumno2}', 'aprobado')`), r));
await db.exec(`delete from public.tutor_profiles where id = '${ids.docente2}'`);
await as(db, "docente2", () => expectFail("un docente NO puede crearse la fila pública ya aprobada",
  q(db, `insert into public.tutor_profiles (id, verification_status) values ('${ids.docente2}', 'aprobado')`), r));
await as(db, "docente2", () => expectOk("...pero SI como pendiente",
  q(db, `insert into public.tutor_profiles (id, bio) values ('${ids.docente2}', 'bio')`), r));

// --- El alta de un docente nuevo ----------------------------------------------------------------------------------
await db.exec(`insert into auth.users (id, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000d9', '{"full_name":"Docente nuevo","role":"docente"}')`);
{
  const x = await q(db, `select id from public.tutor_private where id = '00000000-0000-0000-0000-0000000000d9'`);
  r.push([x.rows.length === 1, "un docente que se registra nace con su fila privada"]);
}
await db.exec(`insert into auth.users (id, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000a9', '{"full_name":"Alumno nuevo","role":"alumno"}')`);
{
  const x = await q(db, `select id from public.tutor_private where id = '00000000-0000-0000-0000-0000000000a9'`);
  r.push([x.rows.length === 0, "un alumno que se registra no tiene fila privada"]);
}

// --- Se borra junto con el perfil ----------------------------------------------------------------------------------------
await db.exec(`delete from public.tutor_profiles where id = '00000000-0000-0000-0000-0000000000d9'`);
{
  const x = await q(db, `select id from public.tutor_private where id = '00000000-0000-0000-0000-0000000000d9'`);
  r.push([x.rows.length === 0, "al borrar el perfil se borra también la fila privada"]);
}

report(r);
