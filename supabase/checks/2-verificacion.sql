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

  -- 12 a 15. Cimientos del cobro (migración 0011).
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

  -- 16. Datos: reservas «confirmada» o «completada» sin pago aprobado (resto del hueco anterior a 0008).
  if to_regclass('public.bookings') is not null then
    select count(*) into v_n from public.bookings b
    where b.status in ('confirmada', 'completada')
      and not exists (select 1 from public.payments p where p.booking_id = b.id and p.status = 'aprobado');
    insert into _verificacion values
      (16, format('reservas confirmadas o completadas sin pago aprobado: %s', v_n), v_n = 0, 'REVISAR');
  end if;

  -- 17. Hay al menos una cuenta de administración.
  if to_regclass('public.profiles') is not null then
    select count(*) into v_n from public.profiles where role = 'administrador';
    insert into _verificacion values
      (17, format('cuentas de administración: %s', v_n), v_n > 0, 'REVISAR');
  end if;

  -- 18. Cuentas del seed de demo viejo (su contraseña era pública).
  if exists (select 1 from information_schema.columns
             where table_schema = 'auth' and table_name = 'users' and column_name = 'email') then
    execute $q$ select count(*) from auth.users where email like '%.demo@estudiapp.test' $q$ into v_n;
    insert into _verificacion values
      (18, format('cuentas de demo (*.demo@estudiapp.test): %s', v_n), v_n = 0, 'REVISAR');
  else
    insert into _verificacion values (18, 'cuentas de demo: no se pudo comprobar', null, 'REVISAR');
  end if;
end;
$$;

select
  orden,
  comprobacion,
  case when ok then 'OK' when ok is null then 'NO SE PUDO COMPROBAR' else si_falla end as resultado
from _verificacion
order by orden;
