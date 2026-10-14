import { ids } from "./harness.mjs";

/** Datos base comunes a todas las pruebas (se cargan como superusuario). */
export async function seed(db) {
  // Cada cuenta tiene un email de prueba (`<clave>@ejemplo.test`), como en Supabase (auth.users.email).
  // No usa el sufijo `.demo@estudiapp.test`, que la verificación de supabase/checks trata como cuenta de demo.
  const u = (id, role, label) =>
    `insert into auth.users (id, email, raw_user_meta_data) values ('${id}', '${label}@ejemplo.test', '{"full_name":"${role} ${id.slice(-2)}","role":"${role}"}');`;
  await db.exec(`
    ${u(ids.alumno, "alumno", "alumno")} ${u(ids.alumno2, "alumno", "alumno2")} ${u(ids.docente, "docente", "docente")} ${u(ids.docente2, "docente", "docente2")} ${u(ids.admin, "alumno", "admin")}
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
  // Desde la migración 0014 no se puede reservar con un docente sin cuenta de cobro vigente: el docente
  // base ya la tiene (con tokens de relleno, que no sirven para nada). Cuenta de Mercado Pago: «seed-mp-d1».
  await linkPayoutAccount(db, ids.docente, "seed-mp-d1");
}

/**
 * Vincula (si existe la tabla de la migración 0011) una cuenta de cobro VIGENTE a un docente, con tokens
 * de relleno. Las suites que reservan con otro docente la usan para poder crear reservas.
 */
export async function linkPayoutAccount(db, tutorId, mpUserId, { expiresIn = "100 days" } = {}) {
  const hay = (await db.query(`select to_regclass('public.mp_credentials') as t`)).rows[0].t !== null;
  if (!hay) return;
  await db.exec(`
    insert into public.mp_credentials (tutor_id, mp_user_id, access_token, refresh_token, expires_at)
    values ('${tutorId}', '${mpUserId}', 'relleno-no-valido', 'relleno-no-valido', now() + interval '${expiresIn}')
    on conflict (tutor_id) do update
      set mp_user_id = excluded.mp_user_id, access_token = excluded.access_token,
          refresh_token = excluded.refresh_token, expires_at = excluded.expires_at;
  `);
}
