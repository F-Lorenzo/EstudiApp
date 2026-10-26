-- EstudiApp — Verificación después de aplicar las migraciones.
--
-- SOLO LEE los datos de la app: crea una tabla temporal para armar el informe y no toca nada más.
-- Pegalo en el SQL Editor y ejecutalo. Cada fila tiene que decir OK.
--   FALLA     algo de las migraciones no quedó como debe: no sigas, avisá.
--   REVISAR   las migraciones están bien, pero hay datos o configuración para mirar a mano.

drop table if exists pg_temp._verificacion;
create temporary table _verificacion (
  orden int,
  comprobacion text,
  ok boolean,
  si_falla text
);

do $$
declare
  v_n bigint;
  v_m bigint;
begin
  -- 1. La RLS está activada en TODAS las tablas de la app.
  insert into _verificacion
  select 1, 'RLS activada en todas las tablas de public', not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  ), 'FALLA';

  -- 2. Los datos privados del docente ya no están en la tabla pública.
  insert into _verificacion
  select 2, 'tutor_profiles no tiene contacto, respaldo ni cuenta de Mercado Pago', not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tutor_profiles'
      and column_name in ('contacto_verificacion', 'credential_url', 'mercadopago_account_id')
  ), 'FALLA';

  -- 3. La tabla privada existe y un visitante (anon) no tiene ni el permiso de leerla.
  insert into _verificacion
  select 3, 'tutor_private existe y un visitante no puede leerla',
    case when to_regclass('public.tutor_private') is null then false
         else not has_table_privilege('anon', 'public.tutor_private', 'select') end,
    'FALLA';

  -- 4. Una fila privada por cada docente.
  if to_regclass('public.tutor_private') is not null then
    select count(*) into v_n from public.tutor_profiles;
    select count(*) into v_m from public.tutor_private;
    insert into _verificacion values
      (4, format('cada docente tiene su fila privada (%s de %s)', v_m, v_n), v_n = v_m, 'FALLA');
  else
    insert into _verificacion values (4, 'cada docente tiene su fila privada', false, 'FALLA');
  end if;

  -- 5. Nadie puede escribir reservas directamente desde la API.
  insert into _verificacion
  select 5, 'no hay políticas para crear o editar reservas desde la API', not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'bookings' and cmd in ('INSERT', 'UPDATE', 'ALL')
  ), 'FALLA';

  -- 6. Quién puede ejecutar cada función.
  insert into _verificacion
  select 6, 'solo el backend confirma pagos (confirm_booking_payment)',
    case when to_regprocedure('public.confirm_booking_payment(uuid, text, numeric, numeric)') is null then false
         else not has_function_privilege('anon', 'public.confirm_booking_payment(uuid, text, numeric, numeric)', 'execute')
          and not has_function_privilege('authenticated', 'public.confirm_booking_payment(uuid, text, numeric, numeric)', 'execute') end,
    'FALLA';
  insert into _verificacion
  select 7, 'un visitante no puede reservar ni cancelar; un usuario con sesión sí',
    case when to_regprocedure('public.create_booking(uuid)') is null
           or to_regprocedure('public.cancel_booking(uuid, text)') is null then false
         else not has_function_privilege('anon', 'public.create_booking(uuid)', 'execute')
          and not has_function_privilege('anon', 'public.cancel_booking(uuid, text)', 'execute')
          and has_function_privilege('authenticated', 'public.create_booking(uuid)', 'execute')
          and has_function_privilege('authenticated', 'public.cancel_booking(uuid, text)', 'execute') end,
    'FALLA';
  insert into _verificacion
  select 8, 'cualquiera puede liberar reservas vencidas (sync_bookings)',
    case when to_regprocedure('public.sync_bookings()') is null then false
         else has_function_privilege('anon', 'public.sync_bookings()', 'execute')
          and has_function_privilege('authenticated', 'public.sync_bookings()', 'execute') end,
    'FALLA';

  -- 9. Las guardas (triggers) de las migraciones están todas.
  select count(*) into v_n from pg_trigger
  where tgname in ('on_auth_user_created', 'profiles_protect_role', 'tutor_profiles_protect_review_fields',
                   'tutor_profiles_protect_insert', 'tutor_private_protect', 'ratings_refresh_tutor_rating');
  insert into _verificacion values (9, format('guardas de la base instaladas (%s de 6)', v_n), v_n = 6, 'FALLA');

  -- 10. Índices que evitan duplicados.
  insert into _verificacion
  select 10, 'índices de horario único (franja y reserva activa)',
    to_regclass('public.availability_slots_tutor_start_key') is not null
    and to_regclass('public.bookings_active_slot_key') is not null,
    'FALLA';

  -- 11. Cada reserva guarda su horario.
  insert into _verificacion
  select 11, 'las reservas guardan su horario (starts_at y ends_at obligatorios)', (
    select count(*) = 2 from information_schema.columns
    where table_schema = 'public' and table_name = 'bookings'
      and column_name in ('starts_at', 'ends_at') and is_nullable = 'NO'
  ), 'FALLA';

  -- 12 a 15. Cimientos del cobro (migración 0011). La 16 es de la 0012, la 17 de la 0013, la 18 de la 0014
  -- y la 19 de la 0015. Las filas 20 a 22 son datos para revisar a mano. La 23 es de la 0016, la 24 de la 0017, la 25 de la 0018 y la 26 de la 0019.
  insert into _verificacion
  select 12, 'cobro: los tokens de Mercado Pago (mp_credentials) no se leen ni se escriben desde la API',
    case when to_regclass('public.mp_credentials') is null then false
         else not has_table_privilege('anon', 'public.mp_credentials', 'select')
          and not has_table_privilege('authenticated', 'public.mp_credentials', 'select')
          and not has_table_privilege('authenticated', 'public.mp_credentials', 'insert')
          and not has_table_privilege('authenticated', 'public.mp_credentials', 'update')
          and not has_table_privilege('authenticated', 'public.mp_credentials', 'delete') end,
    'FALLA';
  insert into _verificacion
  select 13, 'cobro: los reembolsos solo se leen desde la API (los escribe el backend)',
    case when to_regclass('public.refunds') is null then false
         else not has_table_privilege('anon', 'public.refunds', 'select')
          and not has_table_privilege('authenticated', 'public.refunds', 'insert')
          and not has_table_privilege('authenticated', 'public.refunds', 'update')
          and not has_table_privilege('authenticated', 'public.refunds', 'delete') end,
    'FALLA';
  insert into _verificacion
  select 14, 'cobro: solo el backend registra reembolsos y avisos de pago',
    case when to_regprocedure('public.mark_refund_result(uuid, refund_status, text, text)') is null
           or to_regprocedure('public.begin_payment_event(text, jsonb)') is null
           or to_regprocedure('public.finish_payment_event(text, text)') is null then false
         else not has_function_privilege('anon', 'public.mark_refund_result(uuid, refund_status, text, text)', 'execute')
          and not has_function_privilege('authenticated', 'public.mark_refund_result(uuid, refund_status, text, text)', 'execute')
          and not has_function_privilege('anon', 'public.begin_payment_event(text, jsonb)', 'execute')
          and not has_function_privilege('authenticated', 'public.begin_payment_event(text, jsonb)', 'execute')
          and not has_function_privilege('anon', 'public.finish_payment_event(text, text)', 'execute')
          and not has_function_privilege('authenticated', 'public.finish_payment_event(text, text)', 'execute')
          and has_function_privilege('service_role', 'public.mark_refund_result(uuid, refund_status, text, text)', 'execute') end,
    'FALLA';
  insert into _verificacion
  select 15, 'cada reserva guarda su comisión (commission_rate obligatoria)', (
    select count(*) = 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'bookings'
      and column_name = 'commission_rate' and is_nullable = 'NO'
  ), 'FALLA';

  -- 16. Avisos de pago (migración 0012): las decisiones sobre el dinero las toma solo el backend.
  --     `enqueue_refund` tiene seis parámetros con la 0012 y siete desde la 0013: vale cualquiera de las dos.
  insert into _verificacion
  select 16, 'cobro: solo el backend decide qué hacer con cada pago y encola reembolsos',
    case when to_regprocedure('public.apply_payment_notification(text, uuid, text, numeric, text, text, numeric)') is null
           or coalesce(to_regprocedure('public.enqueue_refund(text, uuid, uuid, integer, numeric, text, text)'),
                       to_regprocedure('public.enqueue_refund(text, uuid, uuid, integer, numeric, text)')) is null then false
         else not has_function_privilege('anon', 'public.apply_payment_notification(text, uuid, text, numeric, text, text, numeric)', 'execute')
          and not has_function_privilege('authenticated', 'public.apply_payment_notification(text, uuid, text, numeric, text, text, numeric)', 'execute')
          and not has_function_privilege('anon', coalesce(to_regprocedure('public.enqueue_refund(text, uuid, uuid, integer, numeric, text, text)'),
                                                          to_regprocedure('public.enqueue_refund(text, uuid, uuid, integer, numeric, text)'))::oid, 'execute')
          and not has_function_privilege('authenticated', coalesce(to_regprocedure('public.enqueue_refund(text, uuid, uuid, integer, numeric, text, text)'),
                                                                   to_regprocedure('public.enqueue_refund(text, uuid, uuid, integer, numeric, text)'))::oid, 'execute')
          and has_function_privilege('service_role', 'public.apply_payment_notification(text, uuid, text, numeric, text, text, numeric)', 'execute') end,
    'FALLA';

  -- 17. Cancelar con reembolso (migración 0013): la cancelación devuelve el resumen del reembolso (jsonb)
  --     y solo el backend encola reembolsos con la cuenta de cobro o reintenta los pendientes.
  insert into _verificacion
  select 17, 'cobro: cancelar calcula el reembolso (jsonb) y solo el backend reintenta reembolsos',
    case when to_regprocedure('public.cancel_booking(uuid, text)') is null
           or to_regprocedure('public.retryable_refunds(integer)') is null
           or to_regprocedure('public.enqueue_refund(text, uuid, uuid, integer, numeric, text, text)') is null
           or to_regclass('public.refunds') is null then false
         else (select p.prorettype = 'jsonb'::regtype from pg_proc p where p.oid = to_regprocedure('public.cancel_booking(uuid, text)'))
          and exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'refunds' and column_name = 'mp_user_id')
          and has_function_privilege('authenticated', 'public.cancel_booking(uuid, text)', 'execute')
          and not has_function_privilege('anon', 'public.cancel_booking(uuid, text)', 'execute')
          and not has_function_privilege('anon', 'public.retryable_refunds(integer)', 'execute')
          and not has_function_privilege('authenticated', 'public.retryable_refunds(integer)', 'execute')
          and has_function_privilege('service_role', 'public.retryable_refunds(integer)', 'execute')
          and not has_function_privilege('anon', 'public.enqueue_refund(text, uuid, uuid, integer, numeric, text, text)', 'execute')
          and not has_function_privilege('authenticated', 'public.enqueue_refund(text, uuid, uuid, integer, numeric, text, text)', 'execute') end,
    'FALLA';

  -- 18. Cuentas de cobro (migración 0014): solo el backend guarda y renueva tokens; el docente solo
  --     desvincula la suya; cualquiera puede saber si un docente cobra; y reservar exige que cobre.
  insert into _verificacion
  select 18, 'cobro: solo el backend guarda y renueva tokens; reservar exige un docente que pueda cobrar',
    case when to_regprocedure('public.save_mp_credentials(uuid, text, text, text, text, timestamptz, boolean)') is null
           or to_regprocedure('public.rotate_mp_tokens(uuid, text, text, timestamptz)') is null
           or to_regprocedure('public.unlink_my_mp_account()') is null
           or to_regprocedure('public.tutor_can_receive_payments(uuid)') is null
           or to_regprocedure('public.create_booking(uuid)') is null then false
         else not has_function_privilege('anon', 'public.save_mp_credentials(uuid, text, text, text, text, timestamptz, boolean)', 'execute')
          and not has_function_privilege('authenticated', 'public.save_mp_credentials(uuid, text, text, text, text, timestamptz, boolean)', 'execute')
          and has_function_privilege('service_role', 'public.save_mp_credentials(uuid, text, text, text, text, timestamptz, boolean)', 'execute')
          and not has_function_privilege('anon', 'public.rotate_mp_tokens(uuid, text, text, timestamptz)', 'execute')
          and not has_function_privilege('authenticated', 'public.rotate_mp_tokens(uuid, text, text, timestamptz)', 'execute')
          and has_function_privilege('service_role', 'public.rotate_mp_tokens(uuid, text, text, timestamptz)', 'execute')
          and not has_function_privilege('anon', 'public.unlink_my_mp_account()', 'execute')
          and has_function_privilege('authenticated', 'public.unlink_my_mp_account()', 'execute')
          and has_function_privilege('anon', 'public.tutor_can_receive_payments(uuid)', 'execute')
          and has_function_privilege('authenticated', 'public.tutor_can_receive_payments(uuid)', 'execute')
          and exists (select 1 from pg_proc p
                      where p.oid = to_regprocedure('public.create_booking(uuid)') and p.prosrc like '%tutor_not_payable%') end,
    'FALLA';

  -- 19. Bandeja de emails (migración 0015): la tabla es solo del backend (con la RLS activada y sin permisos
  --     para la API), también sus funciones, y los tres triggers que anotan los emails están instalados.
  insert into _verificacion
  select 19, 'emails: la bandeja (email_outbox) y sus funciones son solo del backend, y los triggers están',
    case when to_regclass('public.email_outbox') is null
           or to_regprocedure('public.claim_pending_emails(integer)') is null
           or to_regprocedure('public.mark_email_result(uuid, text, text)') is null then false
         else (select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.email_outbox'))
          and not has_table_privilege('anon', 'public.email_outbox', 'select')
          and not has_table_privilege('anon', 'public.email_outbox', 'insert')
          and not has_table_privilege('authenticated', 'public.email_outbox', 'select')
          and not has_table_privilege('authenticated', 'public.email_outbox', 'insert')
          and not has_table_privilege('authenticated', 'public.email_outbox', 'update')
          and not has_table_privilege('authenticated', 'public.email_outbox', 'delete')
          and not has_function_privilege('anon', 'public.claim_pending_emails(integer)', 'execute')
          and not has_function_privilege('authenticated', 'public.claim_pending_emails(integer)', 'execute')
          and has_function_privilege('service_role', 'public.claim_pending_emails(integer)', 'execute')
          and not has_function_privilege('anon', 'public.mark_email_result(uuid, text, text)', 'execute')
          and not has_function_privilege('authenticated', 'public.mark_email_result(uuid, text, text)', 'execute')
          and has_function_privilege('service_role', 'public.mark_email_result(uuid, text, text)', 'execute')
          and (select count(*) = 3 from pg_trigger
               where tgname in ('bookings_enqueue_confirmed_emails', 'bookings_enqueue_cancelled_emails', 'refunds_enqueue_approved_email')
                 and not tgisinternal) end,
    'FALLA';

  -- 23. Calificaciones (migración 0016): la tabla ya no es pública (la leen las partes de la clase y la
  --     administración), las opiniones públicas salen de tutor_reviews y el trigger que fija la fecha está.
  --     Va al final para no cambiar el número de las filas anteriores.
  insert into _verificacion
  select 23, 'calificaciones: la tabla no es pública, las opiniones salen de tutor_reviews y la fecha la pone la base',
    case when to_regprocedure('public.tutor_reviews(uuid, integer)') is null then false
         else not exists (select 1 from pg_policies
                          where schemaname = 'public' and tablename = 'ratings'
                            and policyname = 'ratings_select_public_when_tutor_approved')
          and exists (select 1 from pg_policies
                      where schemaname = 'public' and tablename = 'ratings'
                        and policyname = 'ratings_select_parties_or_admin')
          and has_function_privilege('anon', 'public.tutor_reviews(uuid, integer)', 'execute')
          and not has_function_privilege('authenticated', 'public.normalize_rating()', 'execute')
          and exists (select 1 from pg_trigger where tgname = 'ratings_normalize' and not tgisinternal) end,
    'FALLA';

  -- 24. Asistencia (migración 0017): la tabla y sus funciones son del backend, y sync_bookings ya no completa
  --     una clase apenas termina (espera su asistencia hasta 3 días).
  insert into _verificacion
  select 24, 'asistencia: class_attendance y record_class_attendance son del backend, y las clases esperan su asistencia',
    case when to_regclass('public.class_attendance') is null
           or to_regprocedure('public.record_class_attendance(uuid, integer, integer)') is null
           or to_regprocedure('public.classes_awaiting_attendance(integer)') is null then false
         else (select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.class_attendance'))
          and not has_table_privilege('anon', 'public.class_attendance', 'select')
          and not has_table_privilege('authenticated', 'public.class_attendance', 'insert')
          and not has_table_privilege('authenticated', 'public.class_attendance', 'update')
          and not has_table_privilege('authenticated', 'public.class_attendance', 'delete')
          and not has_function_privilege('anon', 'public.record_class_attendance(uuid, integer, integer)', 'execute')
          and not has_function_privilege('authenticated', 'public.record_class_attendance(uuid, integer, integer)', 'execute')
          and has_function_privilege('service_role', 'public.record_class_attendance(uuid, integer, integer)', 'execute')
          and not has_function_privilege('authenticated', 'public.classes_awaiting_attendance(integer)', 'execute')
          and exists (select 1 from pg_proc p
                      where p.oid = to_regprocedure('public.sync_bookings()') and p.prosrc like '%interval ''3 days''%') end,
    'FALLA';

  -- 25. Recordatorios y decisión sobre el perfil (migración 0018): solo del backend, con su trigger, y la bandeja
  --     descarta los recordatorios que ya no corresponden antes de reclamar.
  insert into _verificacion
  select 25, 'emails: los recordatorios de clase son del backend y el docente recibe la decisión sobre su perfil',
    case when to_regprocedure('public.enqueue_class_reminders()') is null
           or to_regprocedure('public.enqueue_tutor_decision_email()') is null then false
         else not has_function_privilege('anon', 'public.enqueue_class_reminders()', 'execute')
          and not has_function_privilege('authenticated', 'public.enqueue_class_reminders()', 'execute')
          and has_function_privilege('service_role', 'public.enqueue_class_reminders()', 'execute')
          and not has_function_privilege('authenticated', 'public.enqueue_tutor_decision_email()', 'execute')
          and exists (select 1 from pg_trigger
                      where tgname = 'tutor_profiles_enqueue_decision_email' and not tgisinternal)
          and exists (select 1 from pg_proc p
                      where p.oid = to_regprocedure('public.claim_pending_emails(integer)')
                        and p.prosrc like '%recordatorio_24h%') end,
    'FALLA';

  -- 26. Registro de acciones (migración 0019): solo lo lee la administración, nadie lo escribe desde la API ni lo
  --     edita, y decidir sobre un perfil pasa por decide_tutor_profile.
  insert into _verificacion
  select 26, 'registro: audit_log lo lee solo la administración, no se edita ni se borra, y las decisiones quedan anotadas',
    case when to_regclass('public.audit_log') is null
           or to_regprocedure('public.decide_tutor_profile(uuid, text, text)') is null then false
         else (select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.audit_log'))
          and not has_table_privilege('anon', 'public.audit_log', 'select')
          and not has_table_privilege('authenticated', 'public.audit_log', 'insert')
          and not has_table_privilege('authenticated', 'public.audit_log', 'update')
          and not has_table_privilege('authenticated', 'public.audit_log', 'delete')
          and exists (select 1 from pg_policies
                      where schemaname = 'public' and tablename = 'audit_log' and policyname = 'audit_log_select_admin')
          and not has_function_privilege('anon', 'public.decide_tutor_profile(uuid, text, text)', 'execute')
          and exists (select 1 from pg_trigger where tgname = 'audit_log_immutable' and not tgisinternal)
          and exists (select 1 from pg_trigger where tgname = 'tutor_profiles_audit_status' and not tgisinternal)
          and exists (select 1 from pg_trigger where tgname = 'bookings_audit_admin_cancel' and not tgisinternal)
          and exists (select 1 from pg_trigger where tgname = 'profiles_audit_role' and not tgisinternal) end,
    'FALLA';

  -- 20. Datos: reservas «confirmada» o «completada» sin pago aprobado (resto del hueco anterior a 0008).
  if to_regclass('public.bookings') is not null then
    select count(*) into v_n from public.bookings b
    where b.status in ('confirmada', 'completada')
      and not exists (select 1 from public.payments p where p.booking_id = b.id and p.status = 'aprobado');
    insert into _verificacion values
      (20, format('reservas confirmadas o completadas sin pago aprobado: %s', v_n), v_n = 0, 'REVISAR');
  end if;

  -- 21. Hay al menos una cuenta de administración.
  if to_regclass('public.profiles') is not null then
    select count(*) into v_n from public.profiles where role = 'administrador';
    insert into _verificacion values
      (21, format('cuentas de administración: %s', v_n), v_n > 0, 'REVISAR');
  end if;

  -- 22. Cuentas del seed de demo viejo (su contraseña era pública).
  if exists (select 1 from information_schema.columns
             where table_schema = 'auth' and table_name = 'users' and column_name = 'email') then
    execute $q$ select count(*) from auth.users where email like '%.demo@estudiapp.test' $q$ into v_n;
    insert into _verificacion values
      (22, format('cuentas de demo (*.demo@estudiapp.test): %s', v_n), v_n = 0, 'REVISAR');
  else
    insert into _verificacion values (22, 'cuentas de demo: no se pudo comprobar', null, 'REVISAR');
  end if;
end;
$$;

select
  orden,
  comprobacion,
  case when ok then 'OK' when ok is null then 'NO SE PUDO COMPROBAR' else si_falla end as resultado
from _verificacion
order by orden;
