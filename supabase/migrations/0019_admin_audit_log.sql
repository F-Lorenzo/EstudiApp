-- 0019 — Registro de acciones y decisiones sobre los perfiles docentes (Fase 3, ítems 2 y 5).
--
-- Decisiones del 26 de octubre de 2026:
--   · Reabrir un perfil rechazado lo devuelve a «pendiente»: se aprueba desde la cola, como cualquier otro.
--   · La administración puede dar de baja a un docente aprobado, con motivo obligatorio. Deja de aparecer en el
--     catálogo y recibe el email; sus clases ya confirmadas siguen en pie (si hay que cancelarlas, una por una).
--   · Se registra toda acción de la administración que cambia algo: aprobar, rechazar, reabrir, dar de baja,
--     cancelar una clase y cambiar el rol de una cuenta. Con quién, cuándo y el motivo. Lo leen solo las cuentas
--     de administración y nadie lo puede editar ni borrar.
--   · Al reabrir un perfil, el docente recibe un email.
--
-- Piezas:
--   · audit_log                 el registro. Lo escriben solo los triggers (la API no tiene permisos de
--                               escritura) y un trigger impide editar o borrar filas, también con la service
--                               role. Además de la administración anota los cambios de estado de un perfil
--                               que no hizo ella (el docente que reenvía su perfil, un cambio desde el SQL
--                               Editor), así la ficha muestra el historial completo de decisiones.
--   · decide_tutor_profile      el único camino de la app para decidir sobre un perfil: valida que la acción
--                               tenga sentido para el estado actual y que lleve motivo cuando lo necesita.
--   · rechazado con motivo      un perfil rechazado (o dado de baja) siempre tiene motivo.
--   · emails                    el de la decisión (0018) suma «perfil_reabierto» y distingue una baja de un
--                               rechazo. La bandeja descarta el de reapertura si el perfil ya no está pendiente.
--
-- Requiere 0001 a 0018.

-- 1. El registro --------------------------------------------------------------------------------------------------
--
-- Sin claves foráneas a propósito: una fila del registro no cambia ni desaparece aunque se borre la cuenta o la
-- reserva. Por eso guarda también el nombre de quien actuó, tal como era en ese momento.

create table public.audit_log (
  id bigint generated always as identity primary key,
  -- administracion: una cuenta de administración con sesión · docente: el propio docente · sistema: sin
  -- sesión de usuario (SQL Editor, procesos del servidor).
  actor_kind text not null check (actor_kind in ('administracion', 'docente', 'sistema')),
  actor_id uuid,
  actor_name text,
  -- aprobar · rechazar · reabrir · dar_de_baja · reenviar · cambiar_estado · cancelar_clase · cambiar_rol
  action text not null,
  target_type text not null check (target_type in ('docente', 'reserva', 'cuenta')),
  target_id uuid not null,
  reason text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_target_idx on public.audit_log (target_type, target_id, created_at desc);
create index audit_log_created_idx on public.audit_log (created_at desc);

alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;

create policy "audit_log_select_admin"
  on public.audit_log for select
  using (public.is_admin());

-- Nadie edita ni borra el registro (ni siquiera la service role: el trigger corre para todos).
create function public.protect_audit_log()
returns trigger
language plpgsql
as $$
begin
  raise exception 'El registro de acciones no se edita ni se borra.' using hint = 'audit_log_immutable';
end;
$$;

revoke all on function public.protect_audit_log() from public, anon, authenticated;

create trigger audit_log_immutable
  before update or delete on public.audit_log
  for each row execute function public.protect_audit_log();

create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function public.protect_audit_log();

-- Quién está actuando ahora. Ayudante interno de los triggers.
create function public.audit_actor()
returns table (kind text, id uuid, name text)
language sql
stable
security definer
set search_path = public
as $$
  select
    case
      when auth.uid() is null then 'sistema'
      when p.role = 'administrador' then 'administracion'
      when p.role = 'docente' then 'docente'
      else 'sistema'
    end,
    auth.uid(),
    nullif(btrim(p.full_name), '')
  from (select 1) one
  left join public.profiles p on p.id = auth.uid();
$$;

revoke all on function public.audit_actor() from public, anon, authenticated;

-- 2. Un perfil rechazado siempre tiene motivo ------------------------------------------------------------------------
--
-- `not valid`: se exige en adelante; un rechazo viejo sin motivo no impide aplicar la migración.

alter table public.tutor_profiles
  add constraint tutor_profiles_rejection_reason
  check (verification_status <> 'rechazado' or nullif(btrim(verification_reason), '') is not null) not valid;

-- 3. Decidir sobre un perfil (la administración) ------------------------------------------------------------------------
--
--   aprobar       pendiente → aprobado
--   rechazar      pendiente → rechazado      motivo obligatorio (se le muestra al docente)
--   reabrir       rechazado → pendiente      nota opcional (solo para el registro)
--   dar_de_baja   aprobado  → rechazado      motivo obligatorio (se le muestra al docente)
--
-- Devuelve el estado nuevo. Errores (hint): not_admin, invalid_action, not_found, invalid_transition,
-- reason_required. El motivo se recorta (sin espacios sobrantes, hasta 500 caracteres).

create function public.decide_tutor_profile(p_tutor_id uuid, p_action text, p_reason text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.tutor_verification_status;
  v_from public.tutor_verification_status;
  v_to public.tutor_verification_status;
  v_reason text := left(nullif(btrim(p_reason), ''), 500);
begin
  if not public.is_admin() then
    raise exception 'Solo la administración decide sobre los perfiles.' using hint = 'not_admin';
  end if;

  case p_action
    when 'aprobar' then v_from := 'pendiente'; v_to := 'aprobado';
    when 'rechazar' then v_from := 'pendiente'; v_to := 'rechazado';
    when 'reabrir' then v_from := 'rechazado'; v_to := 'pendiente';
    when 'dar_de_baja' then v_from := 'aprobado'; v_to := 'rechazado';
    else raise exception 'Acción desconocida.' using hint = 'invalid_action';
  end case;

  select verification_status into v_current
  from public.tutor_profiles
  where id = p_tutor_id
  for update;

  if not found then
    raise exception 'No encontramos ese perfil.' using hint = 'not_found';
  end if;

  if v_current <> v_from then
    raise exception 'El perfil ya no está en el estado esperado.' using hint = 'invalid_transition';
  end if;

  if v_to = 'rechazado' and v_reason is null then
    raise exception 'Falta el motivo.' using hint = 'reason_required';
  end if;

  -- El trigger del registro toma la acción y la nota de acá (valen solo en esta transacción).
  perform set_config('estudiapp.audit_action', p_action, true);
  perform set_config('estudiapp.audit_reason', coalesce(v_reason, ''), true);

  update public.tutor_profiles
  set verification_status = v_to,
      verification_reason = case when v_to = 'rechazado' then v_reason end
  where id = p_tutor_id;

  perform set_config('estudiapp.audit_action', '', true);
  perform set_config('estudiapp.audit_reason', '', true);

  return v_to::text;
end;
$$;

revoke all on function public.decide_tutor_profile(uuid, text, text) from public, anon;
grant execute on function public.decide_tutor_profile(uuid, text, text) to authenticated, service_role;

-- 4. Registrar los cambios de estado de un perfil -------------------------------------------------------------------

create function public.audit_tutor_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor record;
  v_action text := nullif(current_setting('estudiapp.audit_action', true), '');
  v_reason text := nullif(current_setting('estudiapp.audit_reason', true), '');
begin
  select * into v_actor from public.audit_actor();

  if v_action is null then
    v_action := case
      when v_actor.kind = 'docente' and v_actor.id = new.id
           and old.verification_status = 'rechazado' and new.verification_status = 'pendiente' then 'reenviar'
      when old.verification_status = 'pendiente' and new.verification_status = 'aprobado' then 'aprobar'
      when old.verification_status = 'pendiente' and new.verification_status = 'rechazado' then 'rechazar'
      when old.verification_status = 'rechazado' and new.verification_status = 'pendiente' then 'reabrir'
      when old.verification_status = 'aprobado' and new.verification_status = 'rechazado' then 'dar_de_baja'
      else 'cambiar_estado'
    end;
    if new.verification_status = 'rechazado' then
      v_reason := nullif(btrim(new.verification_reason), '');
    end if;
  end if;

  insert into public.audit_log (actor_kind, actor_id, actor_name, action, target_type, target_id, reason, details)
  values (
    v_actor.kind, v_actor.id, v_actor.name, v_action, 'docente', new.id, v_reason,
    jsonb_build_object(
      'from', old.verification_status,
      'to', new.verification_status,
      'tutor_name', (select nullif(btrim(full_name), '') from public.profiles where id = new.id)));

  return null;
end;
$$;

revoke all on function public.audit_tutor_status_change() from public, anon, authenticated;

create trigger tutor_profiles_audit_status
  after update of verification_status on public.tutor_profiles
  for each row
  when (old.verification_status is distinct from new.verification_status)
  execute function public.audit_tutor_status_change();

-- 5. Registrar las clases que cancela la administración ----------------------------------------------------------------
--
-- Solo con una sesión de administración: las cancelaciones del alumno, del docente o del sistema (ausencia del
-- docente, reserva vencida) no son acciones de la administración.

create function public.audit_admin_booking_cancel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor record;
begin
  select * into v_actor from public.audit_actor();
  if v_actor.kind <> 'administracion' then
    return null;
  end if;

  insert into public.audit_log (actor_kind, actor_id, actor_name, action, target_type, target_id, reason, details)
  values (
    v_actor.kind, v_actor.id, v_actor.name, 'cancelar_clase', 'reserva', new.id,
    nullif(btrim(new.cancellation_reason), ''),
    jsonb_build_object(
      'from', old.status,
      'starts_at', new.starts_at,
      'student_name', (select nullif(btrim(full_name), '') from public.profiles where id = new.student_id),
      'tutor_name', (select nullif(btrim(full_name), '') from public.profiles where id = new.tutor_id)));

  return null;
end;
$$;

revoke all on function public.audit_admin_booking_cancel() from public, anon, authenticated;

create trigger bookings_audit_admin_cancel
  after update of status on public.bookings
  for each row
  when (new.status = 'cancelada' and old.status is distinct from new.status)
  execute function public.audit_admin_booking_cancel();

-- 6. Registrar los cambios de rol de una cuenta -----------------------------------------------------------------------

create function public.audit_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor record;
begin
  select * into v_actor from public.audit_actor();

  insert into public.audit_log (actor_kind, actor_id, actor_name, action, target_type, target_id, details)
  values (
    v_actor.kind, v_actor.id, v_actor.name, 'cambiar_rol', 'cuenta', new.id,
    jsonb_build_object('from', old.role, 'to', new.role, 'account_name', nullif(btrim(new.full_name), '')));

  return null;
end;
$$;

revoke all on function public.audit_role_change() from public, anon, authenticated;

create trigger profiles_audit_role
  after update of role on public.profiles
  for each row
  when (old.role is distinct from new.role)
  execute function public.audit_role_change();

-- 7. Emails de la decisión: reapertura y baja ---------------------------------------------------------------------------
--
-- Como en la 0018, más:
--   · «perfil_reabierto» cuando la administración devuelve un perfil rechazado a revisión (no cuando el docente lo
--     reenvía: lo hizo él).
--   · en «perfil_rechazado», `was_approved: true` si el perfil estaba aprobado (una baja, no un rechazo).

create or replace function public.enqueue_tutor_decision_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text;
begin
  begin
    v_kind := case
      when new.verification_status = 'aprobado' then 'perfil_aprobado'
      when new.verification_status = 'rechazado' then 'perfil_rechazado'
      when new.verification_status = 'pendiente' and old.verification_status = 'rechazado' and public.is_admin()
        then 'perfil_reabierto'
    end;

    if v_kind is not null then
      insert into public.email_outbox (kind, booking_id, recipient_id, payload)
      select
        v_kind,
        null,
        new.id,
        jsonb_strip_nulls(jsonb_build_object(
          'tutor_name', nullif(btrim(p.full_name), ''),
          'reason', case when v_kind = 'perfil_rechazado' then nullif(btrim(new.verification_reason), '') end,
          'was_approved', case when v_kind = 'perfil_rechazado' and old.verification_status = 'aprobado' then true end,
          'can_receive_payments', case when v_kind = 'perfil_aprobado' then public.tutor_can_receive_payments(new.id) end))
      from public.profiles p
      where p.id = new.id;
    end if;
  exception when others then
    raise warning 'No se pudo anotar el email de la decisión sobre el perfil %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

drop trigger tutor_profiles_enqueue_decision_email on public.tutor_profiles;

create trigger tutor_profiles_enqueue_decision_email
  after update of verification_status on public.tutor_profiles
  for each row
  when (old.verification_status is distinct from new.verification_status)
  execute function public.enqueue_tutor_decision_email();

-- 8. Reclamar: la reapertura de un perfil que ya no está pendiente tampoco se manda ---------------------------------
--
-- Igual que en la 0018, salvo el paso de los perfiles, que suma «perfil_reabierto».

create or replace function public.claim_pending_emails(p_limit integer default 20)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  -- Un recordatorio de una clase que ya no está confirmada o que ya empezó no se manda.
  update public.email_outbox o
  set status = 'omitido',
      last_error = 'La clase se canceló o ya empezó.'
  where o.status in ('pendiente', 'fallido')
    and o.kind in ('recordatorio_24h', 'recordatorio_1h')
    and not exists (
      select 1 from public.bookings b
      where b.id = o.booking_id and b.status = 'confirmada' and b.starts_at > now());

  -- La decisión sobre un perfil que después cambió (por ejemplo, rechazado y reenviado a revisión) no se manda.
  update public.email_outbox o
  set status = 'omitido',
      last_error = 'El estado del perfil cambió.'
  where o.status in ('pendiente', 'fallido')
    and o.kind in ('perfil_aprobado', 'perfil_rechazado', 'perfil_reabierto')
    and not exists (
      select 1 from public.tutor_profiles tp
      where tp.id = o.recipient_id
        and tp.verification_status::text = case o.kind
          when 'perfil_aprobado' then 'aprobado'
          when 'perfil_rechazado' then 'rechazado'
          else 'pendiente'
        end);

  update public.email_outbox o
  set status = 'omitido',
      last_error = 'El destinatario no tiene email.'
  where o.status in ('pendiente', 'fallido')
    and o.attempts < 5
    and (o.last_attempt_at is null or o.last_attempt_at <= now() - interval '5 minutes')
    and not exists (
      select 1 from auth.users u
      where u.id = o.recipient_id and nullif(btrim(u.email), '') is not null);

  with picked as (
    select o.id
    from public.email_outbox o
    join auth.users u on u.id = o.recipient_id
    where o.status in ('pendiente', 'fallido')
      and o.attempts < 5
      and (o.last_attempt_at is null or o.last_attempt_at <= now() - interval '5 minutes')
      and nullif(btrim(u.email), '') is not null
    order by o.created_at, o.id
    limit greatest(coalesce(p_limit, 20), 0)
    for update of o skip locked
  ),
  claimed as (
    update public.email_outbox o
    set attempts = o.attempts + 1,
        last_attempt_at = now()
    from picked
    where o.id = picked.id
    returning o.id, o.kind, o.attempts, o.payload, o.recipient_id, o.created_at
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'kind', c.kind,
        'attempts', c.attempts,
        'to_email', u.email,
        'to_name', nullif(btrim(p.full_name), ''),
        'payload', c.payload)
      order by c.created_at, c.id),
    '[]'::jsonb)
  into v_result
  from claimed c
  join auth.users u on u.id = c.recipient_id
  left join public.profiles p on p.id = c.recipient_id;

  return v_result;
end;
$$;

revoke all on function public.claim_pending_emails(integer) from public, anon, authenticated;
grant execute on function public.claim_pending_emails(integer) to service_role;
