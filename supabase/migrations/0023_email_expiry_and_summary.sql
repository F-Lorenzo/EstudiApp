-- 0023 — Emails vencidos y estado de la bandeja (Fase 4: preparar Resend).
--
-- Decisión del 26 de octubre de 2026: un email que no salió en 48 horas vence y no se manda. Así, al
-- configurar Resend no salen los avisos de las pruebas acumulados en la bandeja desde la 0015, y si el
-- proveedor se cae unos días no llega un «tu clase está confirmada» de una clase que ya pasó.
--
--   · claim_pending_emails    (reemplaza a la de la 0019) antes de reclamar, descarta como «omitido» lo que
--                             lleva más de 48 horas sin salir. Lo que agotó los 5 intentos sigue «fallido».
--   · email_outbox_summary    para el panel de la administración: cuántos emails hay en cada estado, desde
--                             cuándo espera el más viejo y los últimos problemas. Sin destinatarios ni
--                             contenido: solo tipo, estado, intentos y el error.
--
-- Requiere 0001 a 0022.

-- 1. Los emails vencen a las 48 horas ------------------------------------------------------------------------------

create or replace function public.claim_pending_emails(p_limit integer default 20)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  -- Un email que no salió en 48 horas ya no sirve (una confirmación de una clase que pasó, los avisos de las
  -- pruebas acumulados antes de configurar el proveedor): se descarta. Los que agotaron los 5 intentos quedan
  -- «fallido», para que se vea el problema.
  update public.email_outbox o
  set status = 'omitido',
      last_error = 'Venció sin enviarse (48 horas).'
  where o.status in ('pendiente', 'fallido')
    and o.attempts < 5
    and o.created_at <= now() - interval '48 hours';

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

-- 2. Estado de la bandeja para la administración ----------------------------------------------------------------------
--
-- Los últimos 7 días por estado, lo que está por salir y los últimos 10 problemas. Solo la administración
-- (hint `not_admin`).

create function public.email_outbox_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Solo la administración ve la bandeja de emails.' using hint = 'not_admin';
  end if;

  select jsonb_build_object(
    'last_7_days', jsonb_build_object(
      'enviado', count(*) filter (where o.status = 'enviado' and o.created_at > now() - interval '7 days'),
      'pendiente', count(*) filter (where o.status = 'pendiente' and o.created_at > now() - interval '7 days'),
      'fallido', count(*) filter (where o.status = 'fallido' and o.created_at > now() - interval '7 days'),
      'omitido', count(*) filter (where o.status = 'omitido' and o.created_at > now() - interval '7 days')),
    'waiting', count(*) filter (where o.status in ('pendiente', 'fallido') and o.attempts < 5),
    'oldest_waiting_at', min(o.created_at) filter (where o.status in ('pendiente', 'fallido') and o.attempts < 5),
    'last_sent_at', max(o.sent_at),
    'problems', coalesce((
      select jsonb_agg(x order by x.at desc)
      from (
        select p.kind, p.status, p.attempts, p.last_error as error, coalesce(p.last_attempt_at, p.created_at) as at
        from public.email_outbox p
        where p.status in ('fallido', 'omitido') and p.last_error is not null
        order by coalesce(p.last_attempt_at, p.created_at) desc
        limit 10
      ) x), '[]'::jsonb))
  into v_result
  from public.email_outbox o;

  return v_result;
end;
$$;

revoke all on function public.email_outbox_summary() from public, anon;
grant execute on function public.email_outbox_summary() to authenticated, service_role;
