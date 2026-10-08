// `scripts/seed-demo.mjs` escribe con la service role directamente en las tablas. Si una migración
// cambia el esquema (una columna obligatoria nueva, una columna que desaparece), el seed se rompe
// recién cuando alguien lo corre. Esta prueba repite las MISMAS escrituras que hace el seed, con
// la misma forma, contra el esquema actual.
import { makeDb, as, ids, expectOk, report } from "./harness.mjs";

const r = [];
const db = await makeDb();
const q = (sql) => db.query(sql);

const MARIA = ids.docente;
const JUAN = ids.docente2;
const SOFIA = ids.alumno;
const TOMAS = ids.alumno2;

await db.exec(`
  insert into auth.users (id, raw_user_meta_data) values
    ('${MARIA}', '{"full_name":"María González","role":"docente"}'),
    ('${JUAN}', '{"full_name":"Juan Pérez","role":"docente"}'),
    ('${SOFIA}', '{"full_name":"Sofía Martínez","role":"alumno"}'),
    ('${TOMAS}', '{"full_name":"Tomás Rodríguez","role":"alumno"}');
`);

await as(db, "service", async () => {
  await expectOk("seed: completar el perfil público del docente",
    q(`update public.tutor_profiles set bio = 'Bio', nivel_academico = 'Profesora (UBA)', tarifa_por_clase = 2500,
         verification_status = 'aprobado', rating_promedio = 4.5 where id = '${MARIA}'`), r);
  await expectOk("seed: contacto del docente en tutor_private (upsert)",
    q(`insert into public.tutor_private (id, contacto_verificacion) values ('${MARIA}', '+54 9 11 5555-0001')
       on conflict (id) do update set contacto_verificacion = excluded.contacto_verificacion`), r);
  await expectOk("seed: materias del docente",
    q(`insert into public.tutor_subjects (tutor_id, subject_id) select '${MARIA}', id from public.subjects where name = 'Matemática'`), r);
  await expectOk("seed: pasar a un alumno a administrador",
    q(`update public.profiles set role = 'administrador' where id = '${TOMAS}'`), r);
  await db.exec(`update public.profiles set role = 'alumno' where id = '${TOMAS}'`);

  await expectOk("seed: franjas (pasada y futura, a cualquier hora)",
    q(`insert into public.availability_slots (id, tutor_id, starts_at, ends_at, is_booked) values
         ('51000000-0000-0000-0000-0000000000f1', '${MARIA}', now() - interval '48 hours', now() - interval '47 hours', true),
         ('51000000-0000-0000-0000-0000000000f2', '${MARIA}', now() + interval '50 hours', now() + interval '51 hours', true)`), r);

  await expectOk("seed: reservas con su horario y precio (0008)",
    q(`insert into public.bookings (student_id, tutor_id, slot_id, status, starts_at, ends_at, price)
       select '${SOFIA}'::uuid, '${MARIA}'::uuid, s.id, 'completada'::booking_status, s.starts_at, s.ends_at, 2500
       from public.availability_slots s where s.id = '51000000-0000-0000-0000-0000000000f1'
       union all
       select '${TOMAS}'::uuid, '${MARIA}'::uuid, s.id, 'confirmada'::booking_status, s.starts_at, s.ends_at, 2500
       from public.availability_slots s where s.id = '51000000-0000-0000-0000-0000000000f2'`), r);

  await expectOk("seed: un pago aprobado por reserva",
    q(`insert into public.payments (booking_id, status, amount, commission_amount, tutor_amount)
       select id, 'aprobado', 2500, 250, 2250 from public.bookings`), r);

  await expectOk("seed: reseña de la clase completada",
    q(`insert into public.ratings (booking_id, student_id, tutor_id, score, comment)
       select id, student_id, tutor_id, 5, 'Excelente clase' from public.bookings where status = 'completada'`), r);
});

{
  const x = (await q(`select rating_promedio from public.tutor_profiles where id = '${MARIA}'`)).rows[0];
  r.push([Number(x.rating_promedio) === 5, "el promedio del docente se recalcula con la reseña"]);
}
await as(db, TOMAS, async () => {
  // La reserva confirmada del seed está paga: no se puede cancelar sin reembolso.
  const id = (await q(`select id from public.bookings where status = 'confirmada'`)).rows[0].id;
  try {
    await q(`select public.cancel_booking('${id}')`);
    r.push([false, "una reserva confirmada del seed no debería cancelarse sin reembolso"]);
  } catch (e) {
    r.push([e.hint === "refund_required", `la reserva confirmada del seed está paga (hint=${e.hint})`]);
  }
});

report(r);
