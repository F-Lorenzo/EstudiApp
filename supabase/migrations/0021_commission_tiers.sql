-- 0021 — Comisión por reputación (Fase 3, ítem 3b). Diseño en docs/FASE-1-PLAN.md.
--
-- Decisión del 26 de octubre de 2026: se construye con los escalones de ejemplo del plan y queda APAGADA hasta
-- que el cliente los confirme. Apagada, todos pagan la comisión base (12 %), igual que hasta ahora.
--
--   · commission_settings     una sola fila: si está encendida, la comisión base y el piso (nunca se cobra
--                             menos que el piso).
--   · commission_tiers        los escalones: con al menos N reseñas y una calificación mínima, tal comisión.
--                             Se editan desde el panel de administración.
--   · tutor_review_stats      las reseñas que cuentan para un docente: solo de clases completadas con el pago
--                             aprobado, una por alumno distinto (si un alumno calificó varias clases, cuenta
--                             el promedio de sus calificaciones), para que un solo alumno no baje la comisión.
--   · commission_rate_for     (reemplaza a la de la 0011) con la regla encendida, la comisión más baja de los
--                             escalones que el docente cumple, nunca menos que el piso; apagada, la base.
--   · commission_preview      para el panel: qué comisión tendría hoy cada docente aprobado.
--
-- Cada reserva sigue guardando la comisión del momento en que se crea (0011): cambiar los escalones o
-- encender la regla NUNCA toca las reservas ya hechas. Cada cambio de la configuración o de un escalón queda
-- en el registro de acciones (0019).
--
-- Pendiente (decisión del cliente): que la administración pueda excluir reseñas fraudulentas, y si el docente
-- ve su escalón en el panel.
--
-- Requiere 0001 a 0020.

-- 1. Configuración ---------------------------------------------------------------------------------------------------

create table public.commission_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  base_rate numeric(5, 4) not null default 0.1200,
  floor_rate numeric(5, 4) not null default 0.0600,
  updated_at timestamptz not null default now(),
  constraint commission_settings_rates check (floor_rate >= 0 and floor_rate <= base_rate and base_rate < 1)
);

insert into public.commission_settings (id) values (true);

create trigger commission_settings_set_updated_at
  before update on public.commission_settings
  for each row execute function public.set_updated_at();

create table public.commission_tiers (
  id uuid primary key default gen_random_uuid(),
  min_reviews integer not null check (min_reviews >= 1),
  min_rating numeric(3, 2) not null check (min_rating between 1 and 5),
  rate numeric(5, 4) not null check (rate >= 0 and rate < 1),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger commission_tiers_set_updated_at
  before update on public.commission_tiers
  for each row execute function public.set_updated_at();

-- Los escalones de ejemplo del plan (menos de 10 reseñas: la base).
insert into public.commission_tiers (min_reviews, min_rating, rate) values
  (10, 4.50, 0.1000),
  (25, 4.70, 0.0800),
  (50, 4.80, 0.0600);

-- Las lee y las edita solo la administración. La configuración no se crea ni se borra: es una sola fila.
alter table public.commission_settings enable row level security;
alter table public.commission_tiers enable row level security;
revoke all on public.commission_settings from anon, authenticated;
revoke all on public.commission_tiers from anon, authenticated;
grant select, update on public.commission_settings to authenticated;
grant select, insert, update, delete on public.commission_tiers to authenticated;

create policy "commission_settings_select_admin" on public.commission_settings for select using (public.is_admin());
create policy "commission_settings_update_admin" on public.commission_settings for update
  using (public.is_admin()) with check (public.is_admin());
create policy "commission_tiers_select_admin" on public.commission_tiers for select using (public.is_admin());
create policy "commission_tiers_insert_admin" on public.commission_tiers for insert with check (public.is_admin());
create policy "commission_tiers_update_admin" on public.commission_tiers for update
  using (public.is_admin()) with check (public.is_admin());
create policy "commission_tiers_delete_admin" on public.commission_tiers for delete using (public.is_admin());

-- 2. Cada cambio queda en el registro de acciones ------------------------------------------------------------------

alter table public.audit_log drop constraint audit_log_target_type_check;
alter table public.audit_log
  add constraint audit_log_target_type_check check (target_type in ('docente', 'reserva', 'cuenta', 'comision'));

create function public.audit_commission_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor record;
  v_row jsonb := to_jsonb(coalesce(new, old));
begin
  select * into v_actor from public.audit_actor();

  insert into public.audit_log (actor_kind, actor_id, actor_name, action, target_type, target_id, details)
  values (
    v_actor.kind, v_actor.id, v_actor.name,
    case
      when tg_table_name = 'commission_settings' then 'cambiar_comision'
      when tg_op = 'INSERT' then 'crear_escalon'
      when tg_op = 'DELETE' then 'borrar_escalon'
      else 'cambiar_escalon'
    end,
    'comision',
    case when tg_table_name = 'commission_settings' then '00000000-0000-0000-0000-000000000000'::uuid
         else (v_row ->> 'id')::uuid end,
    jsonb_strip_nulls(jsonb_build_object(
      'before', case when tg_op <> 'INSERT' then to_jsonb(old) - 'updated_at' - 'created_at' end,
      'after', case when tg_op <> 'DELETE' then to_jsonb(new) - 'updated_at' - 'created_at' end)));

  return null;
end;
$$;

revoke all on function public.audit_commission_change() from public, anon, authenticated;

create trigger commission_settings_audit
  after update on public.commission_settings
  for each row execute function public.audit_commission_change();

create trigger commission_tiers_audit
  after insert or update or delete on public.commission_tiers
  for each row execute function public.audit_commission_change();

-- 3. Las reseñas que cuentan -----------------------------------------------------------------------------------------

create function public.tutor_review_stats(p_tutor uuid)
returns table (reviews integer, average numeric)
language sql
stable
security definer
set search_path = public
as $$
  with per_student as (
    select r.student_id, avg(r.score) as score
    from public.ratings r
    join public.bookings b on b.id = r.booking_id and b.status = 'completada'
    join public.payments p on p.booking_id = b.id and p.status = 'aprobado'
    where r.tutor_id = p_tutor
    group by r.student_id
  )
  select count(*)::integer, round(avg(score), 2) from per_student;
$$;

revoke all on function public.tutor_review_stats(uuid) from public, anon, authenticated;

-- 4. La comisión de un docente ----------------------------------------------------------------------------------------
--
-- Reemplaza a la de la 0011 (misma firma). Ahora lee tablas que solo ve la administración, así que corre como
-- su dueño. Solo devuelve una tasa: no expone las reseñas ni los escalones.

create or replace function public.commission_rate_for(p_tutor uuid)
returns numeric(5, 4)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_settings public.commission_settings%rowtype;
  v_reviews integer;
  v_average numeric;
  v_tier numeric(5, 4);
begin
  select * into v_settings from public.commission_settings where id;
  if not found then
    return 0.1200;
  end if;
  if not v_settings.enabled then
    return v_settings.base_rate;
  end if;

  select s.reviews, s.average into v_reviews, v_average from public.tutor_review_stats(p_tutor) s;

  select min(t.rate) into v_tier
  from public.commission_tiers t
  where t.active and v_reviews >= t.min_reviews and v_average >= t.min_rating;

  return greatest(v_settings.floor_rate, least(v_settings.base_rate, coalesce(v_tier, v_settings.base_rate)));
end;
$$;

-- 5. Vista previa para el panel ---------------------------------------------------------------------------------------
--
-- Por cada docente aprobado: sus reseñas que cuentan, su promedio, la comisión que tendría con la regla
-- encendida y la que se le cobra hoy. Solo la administración (hint `not_admin`).

create function public.commission_preview()
returns table (
  tutor_id uuid,
  tutor_name text,
  reviews integer,
  average numeric,
  rate_if_enabled numeric,
  current_rate numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_settings public.commission_settings%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Solo la administración ve la comisión de los docentes.' using hint = 'not_admin';
  end if;

  select * into v_settings from public.commission_settings where id;

  return query
  select
    tp.id,
    nullif(btrim(p.full_name), ''),
    s.reviews,
    s.average,
    greatest(v_settings.floor_rate, least(v_settings.base_rate, coalesce(
      (select min(t.rate) from public.commission_tiers t
       where t.active and s.reviews >= t.min_reviews and s.average >= t.min_rating),
      v_settings.base_rate))),
    public.commission_rate_for(tp.id)
  from public.tutor_profiles tp
  join public.profiles p on p.id = tp.id
  cross join lateral public.tutor_review_stats(tp.id) s
  where tp.verification_status = 'aprobado'
  order by s.reviews desc, s.average desc nulls last, p.full_name;
end;
$$;

revoke all on function public.commission_preview() from public, anon;
grant execute on function public.commission_preview() to authenticated, service_role;
