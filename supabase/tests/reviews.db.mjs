// Calificación después de la clase y opiniones públicas (migración 0016).
import { makeDb, as, ids, expectFail, expectOk, report } from "./harness.mjs";
import { seed } from "./seed.mjs";

const r = [];
const db = await makeDb();
await seed(db);
const q = (sql, params) => db.query(sql, params);

const B3 = "b0000000-0000-0000-0000-000000000003"; // alumno → docente, completada hace 5 días (del seed)
const B_OLD = "b0000000-0000-0000-0000-0000000000f1"; // completada hace 40 días
const B_OTHER = "b0000000-0000-0000-0000-0000000000f2"; // alumno2 → docente, completada hace 2 días
await db.exec(`
  update public.profiles set full_name = '  Tomás   rodríguez Paz ' where id = '${ids.alumno}';
  update public.profiles set full_name = 'Lucía' where id = '${ids.alumno2}';
  insert into public.availability_slots (id, tutor_id, starts_at, ends_at, is_booked) values
    ('51000000-0000-0000-0000-0000000000f1', '${ids.docente}', now() - interval '40 days', now() - interval '40 days' + interval '1 hour', true),
    ('51000000-0000-0000-0000-0000000000f2', '${ids.docente}', now() - interval '2 days', now() - interval '2 days' + interval '1 hour', true);
  insert into public.bookings (id, student_id, tutor_id, slot_id, status, starts_at, ends_at)
    select v.id::uuid, v.student::uuid, '${ids.docente}', s.id, 'completada', s.starts_at, s.ends_at
    from (values ('${B_OLD}', '${ids.alumno}', '51000000-0000-0000-0000-0000000000f1'),
                 ('${B_OTHER}', '${ids.alumno2}', '51000000-0000-0000-0000-0000000000f2')) as v(id, student, slot)
    join public.availability_slots s on s.id = v.slot::uuid;
`);

const rate = (booking, student, score, comment = null, extra = "") =>
  q(
    `insert into public.ratings (booking_id, student_id, tutor_id, score, comment${extra ? ", created_at" : ""})
     values ($1, $2, $3, $4, $5${extra ? `, ${extra}` : ""})`,
    [booking, student, ids.docente, score, comment],
  );

// --- Quién califica y cuándo -------------------------------------------------------------------------------
await as(db, "alumno", () =>
  expectFail("NO se califica una clase que terminó hace más de 30 días", rate(B_OLD, ids.alumno, 5), r));
await as(db, "alumno", () =>
  expectFail("NO se califica la clase de otro alumno", rate(B_OTHER, ids.alumno, 1), r));
await as(db, "alumno", () =>
  expectFail("NO se deja un comentario de más de 600 caracteres", rate(B3, ids.alumno, 5, "x".repeat(601)), r));
await as(db, "alumno", () =>
  expectOk(
    "el alumno califica su clase completada (con una fecha inventada)",
    rate(B3, ids.alumno, 4, "   Explica muy claro.  ", "'2020-01-01'"),
    r,
  ));
await as(db, "alumno", () =>
  expectFail("NO se califica dos veces la misma clase", rate(B3, ids.alumno, 1), r));
await as(db, "alumno2", () =>
  expectOk("un comentario vacío se guarda sin comentario", rate(B_OTHER, ids.alumno2, 5, "   "), r));

{
  const rows = (await q(`select booking_id, comment, created_at > now() - interval '1 minute' as ahora from public.ratings order by booking_id`)).rows;
  const mine = rows.find((x) => x.booking_id === B3);
  const other = rows.find((x) => x.booking_id === B_OTHER);
  r.push([mine?.comment === "Explica muy claro.", `el comentario se guarda sin espacios sobrantes («${mine?.comment}»)`]);
  r.push([mine?.ahora === true, "la fecha la pone la base, no quien califica"]);
  r.push([other?.comment === null, "el comentario vacío queda en null"]);
  const avg = (await q(`select rating_promedio from public.tutor_profiles where id = '${ids.docente}'`)).rows[0].rating_promedio;
  r.push([Number(avg) === 4.5, `el promedio del docente se actualiza (${avg})`]);
}

await as(db, "alumno", () =>
  expectFail("NO se edita una calificación enviada", q(`update public.ratings set score = 1 where booking_id = '${B3}' returning id`).then((x) => {
    if (!x.rows.length) throw new Error("sin filas");
  }), r));

// --- Quién lee la tabla ------------------------------------------------------------------------------------
const visible = async (who) => as(db, who, async () => (await q(`select id from public.ratings`)).rows.length);
r.push([(await visible("anon")) === 0, "un visitante NO lee la tabla de calificaciones"]);
r.push([(await visible("alumno")) === 1, "el alumno lee solo su calificación"]);
r.push([(await visible("docente")) === 2, "el docente lee las calificaciones de sus clases"]);
r.push([(await visible("docente2")) === 0, "otro docente no las lee"]);

// --- Opiniones públicas ------------------------------------------------------------------------------------
await as(db, "anon", async () => {
  const rows = (await q(`select * from public.tutor_reviews('${ids.docente}')`)).rows;
  r.push([rows.length === 2 && Number(rows[0].review_count) === 2, `un visitante ve las opiniones de un docente aprobado (${rows.length})`]);
  const names = rows.map((x) => x.author_name).sort();
  r.push([JSON.stringify(names) === JSON.stringify(["Lucía", "Tomás R."]), `el autor es el nombre y la inicial del apellido (${names.join(", ")})`]);
  r.push([rows.every((x) => !("student_id" in x)), "las opiniones públicas no llevan el id del alumno"]);
  const one = (await q(`select * from public.tutor_reviews('${ids.docente}', 1)`)).rows;
  r.push([one.length === 1 && Number(one[0].review_count) === 2, "con un límite, el total sigue siendo el de todas"]);
});
await db.exec(`update public.profiles set full_name = '  ' where id = '${ids.alumno2}'`);
await as(db, "anon", async () => {
  const names = (await q(`select author_name from public.tutor_reviews('${ids.docente}')`)).rows.map((x) => x.author_name);
  r.push([names.includes("Estudiante"), "sin nombre cargado, el autor es «Estudiante»"]);
});
await db.exec(`update public.tutor_profiles set verification_status = 'pendiente' where id = '${ids.docente}'`);
await as(db, "anon", async () => {
  const rows = (await q(`select * from public.tutor_reviews('${ids.docente}')`)).rows;
  r.push([rows.length === 0, "las opiniones de un docente no aprobado no se muestran"]);
});

report(r);
