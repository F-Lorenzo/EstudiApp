-- 0025 — Búsqueda del catálogo en la base, sin tildes y por páginas (Fase 4, ítem 2).
--
-- Hasta ahora la app traía TODOS los docentes aprobados y filtraba el texto en el servidor, porque la base no
-- tenía `unaccent`. Con un catálogo grande eso no escala, y sin paginar la página crecía sin fin.
--
--   · unaccent                 extensión de Postgres, en el esquema `extensions` (el de Supabase).
--   · search_tutor_catalog     búsqueda, filtros, orden y una página de resultados, con el total. Corre con los
--                              permisos de quien consulta (la RLS de las tablas base sigue mandando) y la usan el
--                              visitante y cualquier sesión. Devuelve `{ "total": n, "rows": [...] }`.
--
-- La búsqueda ignora mayúsculas y tildes («fisica» encuentra «Física», «nunez» a «Núñez») y cada palabra tiene
-- que aparecer en el nombre o en alguna materia, en cualquier orden («algebra marina»).
--
-- «Con horarios disponibles» pasa a significar que se puede reservar: un horario libre que empieza dentro de
-- una hora o más (el mínimo de `create_booking`) y un docente con la cuenta de cobro vigente (0014). Antes
-- contaban también los horarios de los próximos 60 minutos y los docentes que todavía no pueden cobrar.
--
-- Requiere 0001 a 0024.

-- 1. unaccent -----------------------------------------------------------------------------------------------------------

-- Si alguien la activó antes en otro esquema, la función de abajo no la encontraría: mejor avisar con claridad.
do $$
begin
  if exists (
    select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'unaccent' and n.nspname <> 'extensions'
  ) then
    raise exception 'La extensión unaccent ya está instalada fuera del esquema extensions. Movela con: alter extension unaccent set schema extensions;';
  end if;
end;
$$;

create extension if not exists unaccent with schema extensions;

-- 2. search_tutor_catalog -------------------------------------------------------------------------------------------------
--
-- p_q             texto libre (se usan los primeros 100 caracteres)
-- p_materias      docentes que den al menos una de estas materias
-- p_precio_min/max rango de la tarifa por clase
-- p_disponibilidad solo docentes con algún horario que se pueda reservar
-- p_orden         'precio' (menor primero) o cualquier otro valor = mejor calificación
-- p_limit         tamaño de la página, de 1 a 48
-- p_offset        cuántos resultados saltear

create function public.search_tutor_catalog(
  p_q text default null,
  p_materias text[] default null,
  p_precio_min numeric default null,
  p_precio_max numeric default null,
  p_disponibilidad boolean default false,
  p_orden text default 'calificacion',
  p_limit integer default 10,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_words text[];
  v_limit integer := least(greatest(coalesce(p_limit, 10), 1), 48);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_result jsonb;
begin
  -- Las palabras de la búsqueda, ya sin tildes ni mayúsculas. La forma de dos argumentos de unaccent no depende
  -- del search_path para encontrar el diccionario.
  v_words := array_remove(
    regexp_split_to_array(
      lower(extensions.unaccent('extensions.unaccent'::regdictionary, left(coalesce(p_q, ''), 100))),
      '\s+'
    ),
    ''
  );

  with candidatos as (
    select
      c.id,
      c.full_name,
      c.avatar_url,
      c.bio,
      c.tarifa_por_clase,
      c.rating_promedio,
      c.subject_names,
      (
        exists (
          select 1 from public.availability_slots av
          where av.tutor_id = c.id
            and av.is_booked = false
            and av.starts_at >= now() + interval '1 hour'
        )
        and public.tutor_can_receive_payments(c.id)
      ) as has_availability,
      lower(extensions.unaccent('extensions.unaccent'::regdictionary,
        coalesce(c.full_name, '') || ' ' || array_to_string(c.subject_names, ' '))) as search_key
    from public.tutor_catalog c
    where (p_materias is null or cardinality(p_materias) = 0 or c.subject_names && p_materias)
      and (p_precio_min is null or c.tarifa_por_clase >= p_precio_min)
      and (p_precio_max is null or c.tarifa_por_clase <= p_precio_max)
  ),
  filtrados as (
    select * from candidatos k
    where (not coalesce(p_disponibilidad, false) or k.has_availability)
      -- Cada palabra tiene que aparecer en algún lado; strpos no interpreta comodines como % o _.
      and not exists (select 1 from unnest(v_words) w where strpos(k.search_key, w) = 0)
  ),
  pagina as (
    select * from filtrados
    order by
      case when p_orden = 'precio' then tarifa_por_clase end asc nulls last,
      rating_promedio desc,
      -- `id` desempata: el orden tiene que ser estable entre páginas.
      id
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'total', (select count(*) from filtrados),
    'rows', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', p.id,
            'full_name', p.full_name,
            'avatar_url', p.avatar_url,
            'bio', p.bio,
            'tarifa_por_clase', p.tarifa_por_clase,
            'rating_promedio', p.rating_promedio,
            'subject_names', to_jsonb(p.subject_names),
            'has_availability', p.has_availability
          )
          order by
            case when p_orden = 'precio' then p.tarifa_por_clase end asc nulls last,
            p.rating_promedio desc,
            p.id
        )
        from pagina p
      ),
      '[]'::jsonb
    )
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.search_tutor_catalog(text, text[], numeric, numeric, boolean, text, integer, integer) from public;
grant execute on function public.search_tutor_catalog(text, text[], numeric, numeric, boolean, text, integer, integer)
  to anon, authenticated, service_role;
