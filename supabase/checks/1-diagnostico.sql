-- EstudiApp — ¿Qué migraciones tiene este proyecto de Supabase?
--
-- SOLO LEE: no cambia nada. Pegalo en el SQL Editor y ejecutalo. La última fila dice qué hacer.
-- Mira el catálogo de Postgres (no las tablas), así que funciona aunque falten migraciones.

with estado as (
  select
    to_regclass('public.profiles') is not null as m0001,
    exists (
      select 1 from pg_policies
      where schemaname = 'public' and policyname = 'profiles_select_own_or_admin'
    ) as m0002,
    exists (select 1 from pg_trigger where tgname = 'on_auth_user_created') as m0003,
    -- 0004 agrega credential_url a tutor_profiles; la 0010 lo mueve a tutor_private.
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and column_name = 'credential_url'
        and table_name in ('tutor_profiles', 'tutor_private')
    ) as m0004,
    to_regclass('public.tutor_catalog') is not null as m0005,
    exists (select 1 from pg_trigger where tgname = 'profiles_protect_role') as m0006,
    to_regclass('public.availability_slots_tutor_start_key') is not null as m0007,
    to_regprocedure('public.sync_bookings()') is not null as m0008,
    to_regprocedure('public.is_docente()') is not null as m0009,
    to_regclass('public.tutor_private') is not null as m0010
)
select migracion, case when aplicada then 'sí' else 'NO' end as aplicada
from estado,
  lateral (values
    ('0001 esquema base', m0001),
    ('0002 políticas RLS base', m0002),
    ('0003 alta automática de perfil', m0003),
    ('0004 respaldo del docente y materias', m0004),
    ('0005 vista del catálogo', m0005),
    ('0006 visibilidad y guardas de rol', m0006),
    ('0007 franja única por docente y hora', m0007),
    ('0008 sistema de reservas', m0008),
    ('0009 guardas al crear docentes', m0009),
    ('0010 datos privados del docente', m0010),
    ('→ QUÉ HACER: ' || case
        when m0001 and m0002 and m0003 and m0004 and m0005
             and m0006 and m0007 and m0008 and m0009 and m0010
          then 'nada: están todas. Seguí con supabase/checks/2-verificacion.sql'
        when m0001 and m0002 and m0003 and m0004 and m0005
             and not (m0006 or m0007 or m0008 or m0009 or m0010)
          then 'aplicá supabase/aplicar-0006-a-0010.sql (npm run db:bundle) después de las consultas de control de su encabezado'
        when not (m0001 or m0002 or m0003 or m0004 or m0005
                  or m0006 or m0007 or m0008 or m0009 or m0010)
          then 'proyecto vacío: aplicá 0001 a 0005 en orden y después supabase/aplicar-0006-a-0010.sql'
        when not (m0006 or m0007 or m0008 or m0009 or m0010)
          then 'faltan algunas de 0001 a 0005: aplicá en orden solo las que dicen NO y después el archivo único'
        else 'estado mezclado (algunas de 0006 a 0010 sí y otras no): NO apliques el archivo único; pasale este resultado a quien mantiene el código'
      end, true)
  ) as fila(migracion, aplicada);
