import { ids } from "./harness.mjs";

/** Datos base comunes a todas las pruebas (se cargan como superusuario). */
export async function seed(db) {
  const u = (id, role) =>
    `insert into auth.users (id, raw_user_meta_data) values ('${id}', '{"full_name":"${role} ${id.slice(-2)}","role":"${role}"}');`;
  await db.exec(`
    ${u(ids.alumno, "alumno")} ${u(ids.alumno2, "alumno")} ${u(ids.docente, "docente")} ${u(ids.docente2, "docente")} ${u(ids.admin, "alumno")}
    update public.profiles set role = 'administrador' where id = '${ids.admin}';
    update public.tutor_profiles set verification_status = 'aprobado', bio = 'Bio', tarifa_por_clase = 10000 where id = '${ids.docente}';
    insert into public.tutor_subjects (tutor_id, subject_id) select '${ids.docente}', id from public.subjects where name = 'Matemática';
    insert into public.tutor_subjects (tutor_id, subject_id) select '${ids.docente2}', id from public.subjects where name = 'Física';
    insert into public.availability_slots (id, tutor_id, starts_at, ends_at, is_booked) values
      ('51000000-0000-0000-0000-000000000001', '${ids.docente}', now() + interval '3 days', now() + interval '3 days 1 hour', false),
      ('51000000-0000-0000-0000-000000000002', '${ids.docente}', now() + interval '4 days', now() + interval '4 days 1 hour', true),
      ('51000000-0000-0000-0000-000000000003', '${ids.docente}', now() - interval '5 days', now() - interval '5 days' + interval '1 hour', true);
  `);
  // Desde la migración 0008 la reserva guarda su propio horario.
  const snapshot = (await db.query(`select 1 from information_schema.columns where table_name = $1 and column_name = $2`, ["bookings", "starts_at"])).rows.length > 0;
  await db.exec(`
    insert into public.bookings (id, student_id, tutor_id, slot_id, status${snapshot ? ", starts_at, ends_at" : ""})
    select v.id::uuid, '${ids.alumno}', '${ids.docente}', s.id, v.status::booking_status${snapshot ? ", s.starts_at, s.ends_at" : ""}
    from (values ('b0000000-0000-0000-0000-000000000002', '51000000-0000-0000-0000-000000000002', 'confirmada'),
                 ('b0000000-0000-0000-0000-000000000003', '51000000-0000-0000-0000-000000000003', 'completada')) as v(id, slot, status)
    join public.availability_slots s on s.id = v.slot::uuid;
  `);
}
