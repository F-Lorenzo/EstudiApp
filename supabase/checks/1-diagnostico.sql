-- EstudiApp — ¿Qué migraciones tiene este proyecto de Supabase?
--
-- SOLO LEE: no cambia nada. Pegalo en el SQL Editor y ejecutalo. La última fila dice qué hacer.
-- Mira el catálogo de Postgres (no las tablas), así que funciona aunque falten migraciones.

with estado(n, nombre, aplicada) as (
  values
    (1, '0001 esquema base', to_regclass('public.profiles') is not null),
    (2, '0002 políticas RLS base', exists (
        select 1 from pg_policies
        where schemaname = 'public' and policyname = 'profiles_select_own_or_admin')),
    (3, '0003 alta automática de perfil', exists (select 1 from pg_trigger where tgname = 'on_auth_user_created')),
    -- 0004 agrega credential_url a tutor_profiles; la 0010 lo mueve a tutor_private.
    (4, '0004 respaldo del docente y materias', exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and column_name = 'credential_url'
          and table_name in ('tutor_profiles', 'tutor_private'))),
    (5, '0005 vista del catálogo', to_regclass('public.tutor_catalog') is not null),
    (6, '0006 visibilidad y guardas de rol', exists (select 1 from pg_trigger where tgname = 'profiles_protect_role')),
    (7, '0007 franja única por docente y hora', to_regclass('public.availability_slots_tutor_start_key') is not null),
    (8, '0008 sistema de reservas', to_regprocedure('public.sync_bookings()') is not null),
    (9, '0009 guardas al crear docentes', to_regprocedure('public.is_docente()') is not null),
    (10, '0010 datos privados del docente', to_regclass('public.tutor_private') is not null),
    (11, '0011 cimientos del cobro (comisión, reembolsos, credenciales)', to_regclass('public.refunds') is not null)
),
-- Primera migración que falta, y si desde ahí faltan TODAS las siguientes (un tramo limpio).
resumen as (
  select
    min(n) filter (where not aplicada) as primera_faltante,
    (select max(n) from estado) as ultima,
    count(*) filter (where not aplicada) as faltantes,
    coalesce(
      bool_and(not aplicada) filter (where n >= (select min(n) from estado where not aplicada)),
      true
    ) as tramo_limpio
  from estado
)
select migracion, aplicada
from (
  select n as orden, nombre as migracion, case when aplicada then 'sí' else 'NO' end as aplicada
  from estado
  union all
  select
    1000,
    '→ QUÉ HACER: ' || case
      when faltantes = 0
        then 'nada: están todas. Seguí con supabase/checks/2-verificacion.sql'
      when not tramo_limpio
        then 'estado mezclado (hay migraciones aplicadas después de una que falta): NO apliques el archivo único; pasale este resultado a quien mantiene el código'
      when primera_faltante = 1
        then 'proyecto vacío: corré «npm run db:bundle -- 1 ' || ultima || '» y pegá supabase/aplicar-0001-a-' || lpad(ultima::text, 4, '0') || '.sql'
      else
        'faltan de la ' || lpad(primera_faltante::text, 4, '0') || ' en adelante: corré «npm run db:bundle -- ' || primera_faltante || ' ' || ultima
        || '» y pegá supabase/aplicar-' || lpad(primera_faltante::text, 4, '0') || '-a-' || lpad(ultima::text, 4, '0')
        || '.sql (antes, las consultas de control de su encabezado)'
    end,
    null
  from resumen
) t
order by orden;
