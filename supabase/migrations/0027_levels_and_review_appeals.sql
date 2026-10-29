-- 0027 — Niveles con nombre y apelación de reseñas (decisiones del 28 de octubre de 2026).
--
-- El cliente confirmó la comisión por reputación de la 0021 y definió lo que faltaba:
--
--   · Niveles con nombre. Cada escalón tiene un nombre (se edita desde el panel, igual que sus valores) y la base
--     también: «Profesor» (la base), «Gran profesor», «Maestro» y «Gran maestro» para los escalones de ejemplo.
--   · El docente ve su nivel: `my_commission_level` le devuelve su nivel, su comisión, sus reseñas que cuentan y
--     qué le falta para el siguiente. Solo su propio nivel.
--   · Las reseñas de menos de 3 estrellas se pueden apelar. El docente apela una vez por reseña, con su motivo
--     (`appeal_rating`); la administración acepta o rechaza (`decide_rating_appeal`; rechazar lleva una
--     respuesta para el docente). Aceptada, la reseña se quita: se borra de `ratings`, así deja de contar en el
--     promedio, en las opiniones públicas, en la comisión y en las métricas, sin tocar ninguna de esas funciones.
--     La apelación guarda una copia de la reseña quitada, y el alumno no puede volver a calificar esa clase.
--   · Cada apelación y cada decisión quedan en el registro de acciones (0019).
--
-- Requiere 0001 a 0026.

-- 1. Nombres de los niveles -------------------------------------------------------------------------------------------

alter table public.commission_settings
  add column base_name text not null default 'Profesor'
    constraint commission_settings_base_name check (char_length(btrim(base_name)) between 1 and 40);

alter table public.commission_tiers add column name text;

-- Los escalones que ya existen, en orden de reseñas: Gran profesor, Maestro, Gran maestro (y «Nivel N» si hubiera
-- más). Si la administración los renombra, el nombre nuevo queda en el registro como cualquier otro cambio.
update public.commission_tiers t
set name = coalesce((array['Gran profesor', 'Maestro', 'Gran maestro'])[o.n], 'Nivel ' || (o.n + 1))
from (select id, row_number() over (order by min_reviews, min_rating, id)::integer as n from public.commission_tiers) o
where o.id = t.id;

-- Un escalón nuevo sin nombre (desde el SQL Editor) se llama «Nuevo nivel» hasta que se lo renombre.
alter table public.commission_tiers
  alter column name set default 'Nuevo nivel',
  alter column name set not null,
  add constraint commission_tiers_name check (char_length(btrim(name)) between 1 and 40);

-- 2. El nivel de un docente -------------------------------------------------------------------------------------------
--
-- La misma regla que `commission_rate_for` (0021): el nivel es el escalón activo de comisión más baja entre los que el
-- docente cumple (si dos empatan, el que pide más reseñas); si no cumple ninguno, la base. La comisión nunca baja del
-- piso ni sube de la base. El siguiente nivel es el escalón activo que todavía no cumple y que le daría la comisión
-- inmediatamente más baja que la de hoy. No mira si la regla está encendida: eso lo decide quien la usa.

create function public.commission_level_of(p_tutor uuid)
returns table (
  level_name text,
  rate numeric,
  reviews integer,
  average numeric,
  next_name text,
  next_min_reviews integer,
  next_min_rating numeric,
  next_rate numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_settings public.commission_settings%rowtype;
  v_reviews integer;
  v_average numeric;
  v_tier public.commission_tiers%rowtype;
  v_next public.commission_tiers%rowtype;
  v_rate numeric;
begin
  select * into v_settings from public.commission_settings where id;
  select s.reviews, s.average into v_reviews, v_average from public.tutor_review_stats(p_tutor) s;

  select t.* into v_tier
  from public.commission_tiers t
  where t.active and v_reviews >= t.min_reviews and v_average >= t.min_rating
  order by t.rate, t.min_reviews desc, t.min_rating desc
  limit 1;

  v_rate := greatest(v_settings.floor_rate, least(v_settings.base_rate, coalesce(v_tier.rate, v_settings.base_rate)));

  select t.* into v_next
  from public.commission_tiers t
  where t.active
    and not (v_reviews >= t.min_reviews and coalesce(v_average, 0) >= t.min_rating)
    and greatest(v_settings.floor_rate, t.rate) < v_rate
  order by t.rate desc, t.min_reviews, t.min_rating
  limit 1;

  return query select
    coalesce(v_tier.name, v_settings.base_name),
    v_rate,
    v_reviews,
    v_average,
    v_next.name,
    v_next.min_reviews,
    v_next.min_rating,
    case when v_next.id is null then null else greatest(v_settings.floor_rate, v_next.rate) end;
end;
$$;

revoke all on function public.commission_level_of(uuid) from public, anon, authenticated;

-- Para el panel del docente: su propio nivel (hints `not_authenticated`, `not_tutor`). `enabled` dice si la regla
-- está encendida; apagada, el docente paga la base aunque tenga nivel.
create function public.my_commission_level()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_level record;
  v_enabled boolean;
begin
  if auth.uid() is null then
    raise exception 'Necesitás iniciar sesión.' using hint = 'not_authenticated';
  end if;
  if not exists (select 1 from public.tutor_profiles where id = auth.uid()) then
    raise exception 'Solo un docente tiene nivel.' using hint = 'not_tutor';
  end if;

  select enabled into v_enabled from public.commission_settings where id;
  select * into v_level from public.commission_level_of(auth.uid());

  return jsonb_build_object(
    'enabled', coalesce(v_enabled, false),
    'level_name', v_level.level_name,
    'rate', case when v_enabled then v_level.rate else (select base_rate from public.commission_settings where id) end,
    'reviews', v_level.reviews,
    'average', v_level.average,
    'next', case when v_level.next_name is null then null else jsonb_build_object(
      'name', v_level.next_name,
      'min_reviews', v_level.next_min_reviews,
      'min_rating', v_level.next_min_rating,
      'rate', v_level.next_rate) end);
end;
$$;

revoke all on function public.my_commission_level() from public, anon;
grant execute on function public.my_commission_level() to authenticated, service_role;

-- Para el panel de administración: el nivel de cada docente aprobado (hint `not_admin`).
create function public.commission_levels()
returns table (tutor_id uuid, level_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo la administración ve el nivel de los docentes.' using hint = 'not_admin';
  end if;

  return query
  select tp.id, l.level_name
  from public.tutor_profiles tp
  cross join lateral public.commission_level_of(tp.id) l
  where tp.verification_status = 'aprobado';
end;
$$;

revoke all on function public.commission_levels() from public, anon;
grant execute on function public.commission_levels() to authenticated, service_role;

-- 3. Apelaciones --------------------------------------------------------------------------------------------------------
--
-- Una por reseña (`rating_id unique`). Guarda una copia de la reseña: si se acepta, la reseña se borra de `ratings`
-- y la copia queda para el docente, la administración y el registro. Sin clave foránea a `ratings` por eso mismo; a
-- la reserva sí (si se borra la reserva, se va todo).

create table public.rating_appeals (
  id uuid primary key default gen_random_uuid(),
  rating_id uuid not null unique,
  booking_id uuid not null references public.bookings (id) on delete cascade,
  tutor_id uuid not null references public.tutor_profiles (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  score smallint not null check (score between 1 and 2),
  comment text,
  rated_at timestamptz not null,
  reason text not null check (char_length(reason) between 10 and 600),
  status text not null default 'pendiente' check (status in ('pendiente', 'aceptada', 'rechazada')),
  response text check (char_length(response) <= 600),
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  constraint rating_appeals_decision check ((status = 'pendiente') = (decided_at is null)),
  constraint rating_appeals_rejection_response check (status <> 'rechazada' or response is not null)
);

create index rating_appeals_tutor_idx on public.rating_appeals (tutor_id, created_at desc);
create index rating_appeals_status_idx on public.rating_appeals (status, created_at);
create index rating_appeals_booking_idx on public.rating_appeals (booking_id);

-- La API solo lee: el docente sus apelaciones, el alumno las reseñas suyas que se quitaron (para no ofrecerle
-- calificar de nuevo esa clase) y la administración todas. Se crean y se deciden solo con las funciones de abajo.
alter table public.rating_appeals enable row level security;
revoke all on public.rating_appeals from anon, authenticated;
grant select on public.rating_appeals to authenticated;

create policy "rating_appeals_select_tutor_or_admin"
  on public.rating_appeals for select
  using (tutor_id = auth.uid() or public.is_admin());

create policy "rating_appeals_select_student_removed"
  on public.rating_appeals for select
  using (student_id = auth.uid() and status = 'aceptada');

-- Una reseña quitada no se vuelve a escribir: el alumno no puede calificar otra vez esa clase.
create function public.block_removed_rating()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.rating_appeals a where a.booking_id = new.booking_id and a.status = 'aceptada') then
    raise exception 'La opinión de esta clase se quitó y no se puede volver a calificar.' using hint = 'rating_removed';
  end if;
  return new;
end;
$$;

revoke all on function public.block_removed_rating() from public, anon, authenticated;

create trigger ratings_block_removed
  before insert on public.ratings
  for each row execute function public.block_removed_rating();

-- El registro de acciones suma las reseñas.
alter table public.audit_log drop constraint audit_log_target_type_check;
alter table public.audit_log
  add constraint audit_log_target_type_check
  check (target_type in ('docente', 'reserva', 'cuenta', 'comision', 'contenido', 'resena'));

-- Nombre corto del alumno para el registro y las pantallas: nombre y la inicial del apellido, como en las opiniones
-- públicas (0016).
create function public.short_student_name(p_student uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when coalesce(n.first, '') = '' then 'Estudiante'
    when coalesce(n.second, '') = '' then n.first
    else n.first || ' ' || upper(left(n.second, 1)) || '.'
  end
  from (select 1) one
  left join public.profiles p on p.id = p_student
  cross join lateral (
    select
      split_part(regexp_replace(btrim(coalesce(p.full_name, '')), '\s+', ' ', 'g'), ' ', 1) as first,
      split_part(regexp_replace(btrim(coalesce(p.full_name, '')), '\s+', ' ', 'g'), ' ', 2) as second
  ) n;
$$;

revoke all on function public.short_student_name(uuid) from public, anon, authenticated;

-- 4. Apelar una reseña (el docente) -------------------------------------------------------------------------------------
--
-- Una reseña propia de 1 o 2 estrellas, una sola vez, con un motivo de 10 a 600 caracteres. Devuelve el id de la
-- apelación. Errores (hint): not_authenticated, not_found, not_appealable, already_appealed, reason_required,
-- reason_too_long.

create function public.appeal_rating(p_rating uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rating public.ratings%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
  v_actor record;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Necesitás iniciar sesión.' using hint = 'not_authenticated';
  end if;

  select * into v_rating from public.ratings where id = p_rating and tutor_id = auth.uid() for update;
  if not found then
    raise exception 'No encontramos esa reseña.' using hint = 'not_found';
  end if;
  if v_rating.score >= 3 then
    raise exception 'Solo se apelan las reseñas de menos de 3 estrellas.' using hint = 'not_appealable';
  end if;
  if exists (select 1 from public.rating_appeals where rating_id = p_rating) then
    raise exception 'Esta reseña ya se apeló.' using hint = 'already_appealed';
  end if;
  if v_reason is null or char_length(v_reason) < 10 then
    raise exception 'Contanos por qué la apelás.' using hint = 'reason_required';
  end if;
  if char_length(v_reason) > 600 then
    raise exception 'El motivo es demasiado largo.' using hint = 'reason_too_long';
  end if;

  insert into public.rating_appeals (rating_id, booking_id, tutor_id, student_id, score, comment, rated_at, reason)
  values (v_rating.id, v_rating.booking_id, v_rating.tutor_id, v_rating.student_id, v_rating.score, v_rating.comment,
          v_rating.created_at, v_reason)
  returning id into v_id;

  select * into v_actor from public.audit_actor();
  insert into public.audit_log (actor_kind, actor_id, actor_name, action, target_type, target_id, reason, details)
  values (v_actor.kind, v_actor.id, v_actor.name, 'apelar_resena', 'resena', v_rating.id, v_reason,
    jsonb_build_object(
      'appeal_id', v_id,
      'score', v_rating.score,
      'tutor_name', (select nullif(btrim(full_name), '') from public.profiles where id = v_rating.tutor_id),
      'student_name', public.short_student_name(v_rating.student_id)));

  return v_id;
end;
$$;

revoke all on function public.appeal_rating(uuid, text) from public, anon;
grant execute on function public.appeal_rating(uuid, text) to authenticated, service_role;

-- 5. Decidir una apelación (la administración) --------------------------------------------------------------------------
--
-- Aceptar quita la reseña (la respuesta es opcional); rechazar la deja y lleva una respuesta para el docente.
-- Devuelve el estado nuevo. Errores (hint): not_admin, not_found, already_decided, response_required,
-- response_too_long.

create function public.decide_rating_appeal(p_appeal uuid, p_accept boolean, p_response text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_appeal public.rating_appeals%rowtype;
  v_response text := nullif(btrim(p_response), '');
  v_status text := case when p_accept then 'aceptada' else 'rechazada' end;
  v_actor record;
begin
  if not public.is_admin() then
    raise exception 'Solo la administración decide las apelaciones.' using hint = 'not_admin';
  end if;

  select * into v_appeal from public.rating_appeals where id = p_appeal for update;
  if not found then
    raise exception 'No encontramos esa apelación.' using hint = 'not_found';
  end if;
  if v_appeal.status <> 'pendiente' then
    raise exception 'Esta apelación ya se decidió.' using hint = 'already_decided';
  end if;
  if not p_accept and v_response is null then
    raise exception 'Escribí una respuesta para el docente.' using hint = 'response_required';
  end if;
  if char_length(v_response) > 600 then
    raise exception 'La respuesta es demasiado larga.' using hint = 'response_too_long';
  end if;

  update public.rating_appeals
  set status = v_status, response = v_response, decided_by = auth.uid(), decided_at = now()
  where id = p_appeal;

  -- Quitada: deja de contar en todos lados. El trigger de la 0006 recalcula el promedio del docente.
  if p_accept then
    delete from public.ratings where id = v_appeal.rating_id;
  end if;

  select * into v_actor from public.audit_actor();
  insert into public.audit_log (actor_kind, actor_id, actor_name, action, target_type, target_id, reason, details)
  values (v_actor.kind, v_actor.id, v_actor.name,
    case when p_accept then 'quitar_resena' else 'rechazar_apelacion' end,
    'resena', v_appeal.rating_id, v_response,
    jsonb_build_object(
      'appeal_id', v_appeal.id,
      'score', v_appeal.score,
      'tutor_name', (select nullif(btrim(full_name), '') from public.profiles where id = v_appeal.tutor_id),
      'student_name', public.short_student_name(v_appeal.student_id)));

  return v_status;
end;
$$;

revoke all on function public.decide_rating_appeal(uuid, boolean, text) from public, anon;
grant execute on function public.decide_rating_appeal(uuid, boolean, text) to authenticated, service_role;

-- 6. Lo que ve cada uno -------------------------------------------------------------------------------------------------
--
-- El docente: sus reseñas (las vigentes y las quitadas), con el autor como en las opiniones públicas y el estado de
-- su apelación. Hint `not_authenticated`.

create function public.my_reviews()
returns table (
  rating_id uuid,
  score smallint,
  comment text,
  created_at timestamptz,
  class_starts_at timestamptz,
  author_name text,
  removed boolean,
  appeal_id uuid,
  appeal_status text,
  appeal_reason text,
  appeal_response text,
  appeal_created_at timestamptz,
  appeal_decided_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Necesitás iniciar sesión.' using hint = 'not_authenticated';
  end if;

  return query
  select * from (
    select r.id, r.score, r.comment, r.created_at, b.starts_at, public.short_student_name(r.student_id), false,
           a.id, a.status, a.reason, a.response, a.created_at, a.decided_at
    from public.ratings r
    join public.bookings b on b.id = r.booking_id
    left join public.rating_appeals a on a.rating_id = r.id
    where r.tutor_id = auth.uid()
    union all
    select a.rating_id, a.score, a.comment, a.rated_at, b.starts_at, public.short_student_name(a.student_id), true,
           a.id, a.status, a.reason, a.response, a.created_at, a.decided_at
    from public.rating_appeals a
    join public.bookings b on b.id = a.booking_id
    where a.tutor_id = auth.uid() and a.status = 'aceptada'
  ) x
  order by 4 desc, 1
  limit 200;
end;
$$;

revoke all on function public.my_reviews() from public, anon;
grant execute on function public.my_reviews() to authenticated, service_role;

-- La administración: las apelaciones, primero las pendientes (de la más vieja a la más nueva), después las decididas
-- (de la más reciente a la más vieja). Ve el nombre completo del alumno y del docente. Hint `not_admin`.

create function public.admin_rating_appeals()
returns table (
  appeal_id uuid,
  status text,
  tutor_id uuid,
  tutor_name text,
  student_name text,
  score smallint,
  comment text,
  rated_at timestamptz,
  class_starts_at timestamptz,
  reason text,
  response text,
  created_at timestamptz,
  decided_at timestamptz,
  decided_by_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo la administración ve las apelaciones.' using hint = 'not_admin';
  end if;

  return query
  select a.id, a.status, a.tutor_id, nullif(btrim(pt.full_name), ''), nullif(btrim(ps.full_name), ''), a.score,
         a.comment, a.rated_at, b.starts_at, a.reason, a.response, a.created_at, a.decided_at,
         nullif(btrim(pd.full_name), '')
  from public.rating_appeals a
  join public.bookings b on b.id = a.booking_id
  left join public.profiles pt on pt.id = a.tutor_id
  left join public.profiles ps on ps.id = a.student_id
  left join public.profiles pd on pd.id = a.decided_by
  order by (a.status = 'pendiente') desc,
           case when a.status = 'pendiente' then a.created_at end,
           a.decided_at desc nulls last, a.id
  limit 200;
end;
$$;

revoke all on function public.admin_rating_appeals() from public, anon;
grant execute on function public.admin_rating_appeals() to authenticated, service_role;
