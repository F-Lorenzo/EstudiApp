-- EstudiApp — Catálogo y búsqueda de docentes (sección 6)
-- Vista de solo lectura que agrupa lo necesario para listar, buscar,
-- filtrar y ordenar docentes aprobados en una sola consulta.
--
-- security_invoker = true: la vista corre con los permisos de quien
-- consulta, así que sigue respetando la RLS de las tablas base en vez
-- de heredar los permisos de quien la creó.

create view public.tutor_catalog
with (security_invoker = true) as
select
  tp.id,
  p.full_name,
  p.avatar_url,
  tp.bio,
  tp.tarifa_por_clase,
  tp.rating_promedio,
  coalesce(
    (
      select array_agg(s.name order by s.name)
      from public.tutor_subjects ts
      join public.subjects s on s.id = ts.subject_id
      where ts.tutor_id = tp.id
    ),
    '{}'
  ) as subject_names,
  exists (
    select 1
    from public.availability_slots av
    where av.tutor_id = tp.id
      and av.is_booked = false
      and av.starts_at > now()
  ) as has_availability,
  lower(
    p.full_name || ' ' || coalesce(
      (
        select array_to_string(array_agg(s.name), ' ')
        from public.tutor_subjects ts
        join public.subjects s on s.id = ts.subject_id
        where ts.tutor_id = tp.id
      ),
      ''
    )
  ) as search_text
from public.tutor_profiles tp
join public.profiles p on p.id = tp.id
where tp.verification_status = 'aprobado';

grant select on public.tutor_catalog to anon, authenticated;
