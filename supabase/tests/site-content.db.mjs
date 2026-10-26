// Migración 0022: contenido editable del sitio (texto del hero y franja de anuncio). Se prueba que lo lea
// cualquiera, que lo cambie solo la administración, los límites (renglones, largos, enlaces seguros) y el registro.
import { makeDb, as, expectFail, report } from "./harness.mjs";
import { seed } from "./seed.mjs";

const r = [];
const db = await makeDb();
await seed(db);
const q = (sql) => db.query(sql);
const set = (who, fields) => as(db, who, () => q(`update public.site_content set ${fields} returning id`));

{
  const row = (await q(`select * from public.site_content`)).rows[0];
  r.push([row.hero_title === null && row.announcement_enabled === false, "arranca con el texto original y sin anuncio"]);
  for (const who of ["anon", "alumno", "docente"]) {
    const n = await as(db, who, async () => (await q(`select count(*)::int as n from public.site_content`)).rows[0].n);
    r.push([n === 1, `${who} lee el contenido (es lo que muestra la Home)`]);
  }
}

// Solo la administración lo cambia.
for (const who of ["alumno", "docente"]) {
  const n = await set(who, `hero_title = 'Hackeado'`).then((x) => x.rows.length, () => 0);
  r.push([n === 0, `${who} NO cambia el contenido`]);
}
await as(db, "anon", () => expectFail("un visitante NO cambia el contenido", q(`update public.site_content set hero_title = 'x'`), r));
await as(db, "admin", () => expectFail("no se agrega otra fila", q(`insert into public.site_content (id) values (false)`), r));
await as(db, "admin", () => expectFail("no se borra", q(`delete from public.site_content`), r));

// El hero.
{
  const ok = await set("admin", `hero_title = E'Aprender\\ncambia\\ntodo.', hero_highlight = 'Con vos.', hero_description = 'Clases uno a uno.'`);
  r.push([ok.rows.length === 1, "la administración cambia el texto del hero"]);
  await as(db, "admin", () => expectFail("el título tiene hasta 3 renglones", q(`update public.site_content set hero_title = E'a\\nb\\nc\\nd'`), r));
  await as(db, "admin", () => expectFail("el título tiene hasta 90 caracteres", q(`update public.site_content set hero_title = repeat('x', 91)`), r));
  await as(db, "admin", () => expectFail("la frase subrayada, hasta 30", q(`update public.site_content set hero_highlight = repeat('x', 31)`), r));
  await as(db, "admin", () => expectFail("un título vacío no (para volver al original va null)", q(`update public.site_content set hero_title = ''`), r));
}

// El anuncio.
{
  await as(db, "admin", () => expectFail("encendido sin texto no se guarda", q(`update public.site_content set announcement_enabled = true, announcement_text = null`), r));
  await as(db, "admin", () => expectFail("un enlace sin su texto no se guarda", q(`update public.site_content set announcement_text = 'Hola', announcement_link_url = '/docentes'`), r));
  for (const url of ["javascript:alert(1)", "//malo.example", "http://malo.example", "/\\malo.example", "data:text/html,x"]) {
    await as(db, "admin", () => expectFail(`un enlace «${url}» no se acepta`, q(`update public.site_content set announcement_text = 'Hola', announcement_link_label = 'Ver', announcement_link_url = '${url}'`), r));
  }
  for (const url of ["/docentes", "/", "https://estudiapp.app/como-funciona"]) {
    const ok = await set("admin", `announcement_enabled = true, announcement_text = 'Inscripciones abiertas', announcement_link_label = 'Ver más', announcement_link_url = '${url}', announcement_ends_at = now() + interval '7 days'`);
    r.push([ok.rows.length === 1, `un enlace «${url}» se acepta`]);
  }
}

// El registro.
{
  const log = (await q(`select action, actor_kind, details from public.audit_log where target_type = 'contenido' order by id`)).rows;
  r.push([log.some((x) => x.action === "cambiar_hero" && x.actor_kind === "administracion"), "cambiar el hero queda en el registro"]);
  const anuncio = log.find((x) => x.action === "cambiar_anuncio");
  r.push([anuncio && anuncio.details.after.announcement_enabled === true && anuncio.details.changed.includes("announcement_enabled"), "encender el anuncio también, con lo que cambió"]);
  const antes = log.length;
  await set("admin", `announcement_text = announcement_text`);
  const despues = (await q(`select count(*)::int as n from public.audit_log where target_type = 'contenido'`)).rows[0].n;
  r.push([despues === antes, "guardar sin cambios no agrega nada"]);
}

report(r);
