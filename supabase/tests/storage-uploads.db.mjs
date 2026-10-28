// Migración 0026: fotos de perfil y respaldos en Supabase Storage. Se prueba la configuración de las dos carpetas y
// que cada rol solo pueda escribir en su propia subcarpeta: la foto, cualquier cuenta; el respaldo, solo un docente,
// y que el respaldo lo lean solo su dueño y la administración.
import { makeDb, as, ids, expectFail, expectOk, report, track } from "./harness.mjs";
import { seed } from "./seed.mjs";

const r = track([]);
const db = await makeDb();
await seed(db);
const q = (sql, params) => db.query(sql, params);

const subir = (who, bucket, name) =>
  as(db, who, () => q(`insert into storage.objects (bucket_id, name) values ($1, $2)`, [bucket, name]));
const ver = async (who, bucket) =>
  as(db, who, async () => (await q(`select name from storage.objects where bucket_id = $1 order by name`, [bucket])).rows.map((x) => x.name));
const cuantos = async (bucket, name) =>
  (await q(`select count(*)::int as n from storage.objects where bucket_id = $1 and name = $2`, [bucket, name])).rows[0].n;

// --- Las carpetas ------------------------------------------------------------------------------------------------------
{
  const b = Object.fromEntries((await q(`select * from storage.buckets`)).rows.map((x) => [x.id, x]));
  r.push([b.avatars?.public === true, "la carpeta de fotos es pública"]);
  r.push([Number(b.avatars?.file_size_limit) === 2 * 1024 * 1024, "fotos: hasta 2 MB"]);
  r.push([JSON.stringify(b.avatars?.allowed_mime_types) === JSON.stringify(["image/jpeg", "image/png", "image/webp"]), "fotos: solo JPG, PNG y WebP"]);
  r.push([b.credentials?.public === false, "la carpeta de respaldos es privada"]);
  r.push([Number(b.credentials?.file_size_limit) === 5 * 1024 * 1024, "respaldos: hasta 5 MB"]);
  r.push([JSON.stringify(b.credentials?.allowed_mime_types) === JSON.stringify(["application/pdf", "image/jpeg", "image/png", "image/webp"]), "respaldos: PDF o imagen"]);
}

// --- Fotos de perfil ----------------------------------------------------------------------------------------------------
const fotoAlumno = `${ids.alumno}/a1.webp`;
await expectOk("un alumno sube su foto en su subcarpeta", subir("alumno", "avatars", fotoAlumno), r);
await expectOk("un docente también", subir("docente", "avatars", `${ids.docente}/d1.webp`), r);
await expectFail("no en la subcarpeta de otra cuenta", subir("alumno", "avatars", `${ids.alumno2}/intruso.webp`), r);
await expectFail("no en una subcarpeta adentro de la suya", subir("alumno", "avatars", `${ids.alumno}/otra/a.webp`), r);
await expectFail("no suelta, fuera de toda subcarpeta", subir("alumno", "avatars", `suelta.webp`), r);
await expectFail("un visitante no sube nada", subir("anon", "avatars", `${ids.alumno}/anon.webp`), r);
r.push([JSON.stringify(await ver("alumno", "avatars")) === JSON.stringify([fotoAlumno]), "cada cuenta lista solo sus fotos"]);
r.push([(await ver("alumno2", "avatars")).length === 0, "otra cuenta no ve las fotos ajenas en la lista"]);

// Cambiar y borrar: solo lo propio, y sin mover archivos a otra subcarpeta.
await as(db, "alumno2", () => q(`delete from storage.objects where bucket_id = 'avatars' and name = $1`, [fotoAlumno]));
r.push([(await cuantos("avatars", fotoAlumno)) === 1, "otra cuenta no puede borrar una foto ajena"]);
await as(db, "alumno2", () => q(`update storage.objects set name = $2 where bucket_id = 'avatars' and name = $1`, [fotoAlumno, `${ids.alumno2}/robada.webp`]));
r.push([(await cuantos("avatars", fotoAlumno)) === 1, "ni cambiarla de lugar"]);
await expectFail(
  "el dueño no puede mover su foto a la subcarpeta de otra cuenta",
  as(db, "alumno", () => q(`update storage.objects set name = $2 where bucket_id = 'avatars' and name = $1`, [fotoAlumno, `${ids.alumno2}/regalo.webp`])),
  r,
);
await as(db, "alumno", () => q(`delete from storage.objects where bucket_id = 'avatars' and name = $1`, [fotoAlumno]));
r.push([(await cuantos("avatars", fotoAlumno)) === 0, "el dueño borra su foto vieja"]);

// --- Respaldos de los docentes ------------------------------------------------------------------------------------------
const respaldo = `${ids.docente}/titulo.pdf`;
await expectOk("un docente sube su respaldo", subir("docente", "credentials", respaldo), r);
await expectFail("un alumno no sube respaldos (ni en su subcarpeta)", subir("alumno", "credentials", `${ids.alumno}/x.pdf`), r);
await expectFail("la administración tampoco sube respaldos a su nombre", subir("admin", "credentials", `${ids.admin}/x.pdf`), r);
await expectFail("un docente no sube en la subcarpeta de otro", subir("docente", "credentials", `${ids.docente2}/x.pdf`), r);
await expectFail("un visitante no sube nada", subir("anon", "credentials", `${ids.docente}/anon.pdf`), r);

r.push([JSON.stringify(await ver("docente", "credentials")) === JSON.stringify([respaldo]), "el docente ve su respaldo"]);
r.push([JSON.stringify(await ver("admin", "credentials")) === JSON.stringify([respaldo]), "la administración ve los respaldos (para revisar perfiles)"]);
for (const who of ["docente2", "alumno", "anon"]) {
  r.push([(await ver(who, "credentials")).length === 0, `${who} no ve el respaldo ajeno`]);
}

await as(db, "admin", () => q(`delete from storage.objects where bucket_id = 'credentials' and name = $1`, [respaldo]));
r.push([(await cuantos("credentials", respaldo)) === 1, "la administración lo lee pero no lo borra"]);
await as(db, "docente2", () => q(`update storage.objects set name = $2 where bucket_id = 'credentials' and name = $1`, [respaldo, `${ids.docente2}/mio.pdf`]));
r.push([(await cuantos("credentials", respaldo)) === 1, "otro docente no lo cambia de lugar"]);

// Un docente que deja de serlo ya no sube respaldos (pero puede borrar los suyos).
await db.exec(`update public.profiles set role = 'alumno' where id = '${ids.docente2}'`);
await expectFail("una cuenta que ya no es docente no sube respaldos", subir("docente2", "credentials", `${ids.docente2}/nuevo.pdf`), r);
await db.exec(`update public.profiles set role = 'docente' where id = '${ids.docente2}'`);

await as(db, "docente", () => q(`delete from storage.objects where bucket_id = 'credentials' and name = $1`, [respaldo]));
r.push([(await cuantos("credentials", respaldo)) === 0, "el docente borra su respaldo"]);

report(r);
