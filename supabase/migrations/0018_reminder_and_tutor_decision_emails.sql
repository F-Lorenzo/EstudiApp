-- 0018 — Emails restantes (Fase 3, ítem 1): recordatorio de clase y decisión sobre el perfil docente.
--
-- Decisión del 25 de octubre de 2026: dos recordatorios por clase, uno 24 horas antes y otro 1 hora antes, a
-- las dos partes (alumno y docente). Siguen el mismo camino que los demás emails (0015): la base anota en la
-- bandeja QUÉ avisar y a quién, y el servidor los envía.
--
--   · enqueue_class_reminders   la llama el mantenimiento de cada hora (solo backend). Como corre una vez por
--                               hora, cada recordatorio tiene una ventana de una hora: el de 24 horas sale
--                               entre 23 h 30 min y 24 h 30 min antes, y el de 1 hora, entre 30 y 90 minutos
--                               antes. La restricción única de la bandeja impide que se anote dos veces.
--                               Si la clase se reservó con poca anticipación no se anota el recordatorio que
--                               llegaría pegado al email de la reserva confirmada.
--   · trigger de tutor_profiles al aprobar o rechazar un perfil docente, un email al docente (con el motivo,
--                               si se rechazó). Nunca hace fallar la decisión.
--   · claim_pending_emails      igual que en la 0015, pero antes de reclamar descarta («omitido») los avisos
--                               que ya no corresponden: un recordatorio de una clase que se canceló o ya
--                               empezó, o la decisión sobre un perfil que después cambió. Importa porque sin
--                               envío configurado la bandeja se acumula, y al configurarlo no tiene que salir
--                               un recordatorio viejo.
--
-- Los avisos del perfil no tienen reserva (`booking_id` nulo), así que la restricción única no los frena: un
-- docente rechazado que reenvía su perfil y lo aprueban recibe los dos emails, como corresponde.
--
-- Requiere 0001 a 0017.

-- 1. Recordatorios de clase --------------------------------------------------------------------------------------
--
-- Devuelve cuántos emails se anotaron. Payload: la foto de la reserva (0015) más `booking_id` (para el enlace a
-- la sala) y `recipient_role` («alumno» o «docente»), porque los dos reciben el mismo `kind`.

create function public.enqueue_class_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with due as (
    -- 24 horas antes: si falta poco (menos de 2 horas) ya va el de 1 hora; si se reservó con menos de 25 horas
    -- de anticipación, el email de la reserva confirmada acaba de llegar.
    select b as booking, 'recordatorio_24h' as kind
    from public.bookings b
    where b.status = 'confirmada'
      and b.starts_at > now() + interval '2 hours'
      and b.starts_at <= now() + interval '24 hours 30 minutes'
      and b.created_at <= b.starts_at - interval '25 hours'
    union all
    -- 1 hora antes: salvo que se haya reservado con menos de 2 horas de anticipación.
    select b as booking, 'recordatorio_1h' as kind
    from public.bookings b
    where b.status = 'confirmada'
      and b.starts_at > now()
      and b.starts_at <= now() + interval '90 minutes'
      and b.created_at <= b.starts_at - interval '2 hours'
  ),
  inserted as (
    insert into public.email_outbox (kind, booking_id, recipient_id, payload)
    select d.kind, (d.booking).id, r.recipient_id,
      jsonb_strip_nulls(public.email_booking_payload(d.booking)
        || jsonb_build_object('booking_id', (d.booking).id, 'recipient_role', r.role))
    from due d
    cross join lateral (values ((d.booking).student_id, 'alumno'), ((d.booking).tutor_id, 'docente')) as r (recipient_id, role)
    on conflict (kind, booking_id, recipient_id) do nothing
    returning 1
  )
  select count(*)::integer into v_count from inserted;

  return v_count;
end;
$$;

revoke all on function public.enqueue_class_reminders() from public, anon, authenticated;
grant execute on function public.enqueue_class_reminders() to service_role;

-- 2. Decisión sobre el perfil docente ------------------------------------------------------------------------------
--
-- «perfil_aprobado» (payload: tutor_name, can_receive_payments) o «perfil_rechazado» (tutor_name, reason). El
-- motivo lo escribió la administración y llega tal cual: quien arma el HTML lo escapa.

create function public.enqueue_tutor_decision_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    insert into public.email_outbox (kind, booking_id, recipient_id, payload)
    select
      case new.verification_status when 'aprobado' then 'perfil_aprobado' else 'perfil_rechazado' end,
      null,
      new.id,
      jsonb_strip_nulls(jsonb_build_object(
        'tutor_name', nullif(btrim(p.full_name), ''),
        'reason', case when new.verification_status = 'rechazado' then nullif(btrim(new.verification_reason), '') end,
        'can_receive_payments', case when new.verification_status = 'aprobado' then public.tutor_can_receive_payments(new.id) end))
    from public.profiles p
    where p.id = new.id;
  exception when others then
    raise warning 'No se pudo anotar el email de la decisión sobre el perfil %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public.enqueue_tutor_decision_email() from public, anon, authenticated;

create trigger tutor_profiles_enqueue_decision_email
  after update of verification_status on public.tutor_profiles
  for each row
  when (new.verification_status in ('aprobado', 'rechazado') and old.verification_status is distinct from new.verification_status)
  execute function public.enqueue_tutor_decision_email();

-- 3. Reclamar: antes, descartar lo que ya no corresponde ------------------------------------------------------------
--
-- Igual que en la 0015, con un paso previo.

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
    and o.kind in ('perfil_aprobado', 'perfil_rechazado')
    and not exists (
      select 1 from public.tutor_profiles tp
      where tp.id = o.recipient_id
        and tp.verification_status::text = case o.kind when 'perfil_aprobado' then 'aprobado' else 'rechazado' end);

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
