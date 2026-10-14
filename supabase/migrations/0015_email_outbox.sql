-- 0015 · Bandeja de salida de emails (Fase 1, paso 1.7).
--
-- Los emails de la plataforma (reserva confirmada, nueva reserva, cancelación, reembolso) no se mandan
-- desde la base: ella solo anota QUÉ hay que avisar y a quién, en la misma transacción que el hecho
-- que lo origina. Un proceso del servidor (con la service role) reclama las filas pendientes, las envía
-- con el proveedor de email y anota el resultado:
--
--   · email_outbox            la bandeja. Solo la usa la service role (sin políticas: ni siquiera el
--                             dueño de un email lo lee desde la API).
--   · triggers                encolan los emails cuando una reserva queda confirmada, cuando se cancela
--                             una reserva paga y cuando se aprueba un reembolso. Son idempotentes
--                             (restricción única) y NUNCA hacen fallar la operación que los dispara: si
--                             anotar el email falla, la operación sigue y queda un aviso en el log.
--   · claim_pending_emails    reclama las filas por enviar (con reintentos espaciados).
--   · mark_email_result       anota si se envió, falló o se omitió. Una fila enviada no vuelve atrás.
--
-- El `payload` es una FOTO de lo necesario para armar el mensaje en ese momento (nombres, horario,
-- precio, monto reembolsado, motivo, quién canceló). NUNCA lleva el email del destinatario: se lee de
-- `auth.users` recién al reclamar la fila. Los textos que escribió una persona (nombres, motivo de la
-- cancelación) llegan tal cual: quien arma el HTML del email tiene que escaparlos.
--
-- Las reservas que vencen o se cancelan SIN pago no generan emails: nunca estuvieron confirmadas.
--
-- Requiere 0001 a 0014.

-- 1. La bandeja ---------------------------------------------------------------------------------------------------------

create type email_status as enum ('pendiente', 'enviado', 'fallido', 'omitido');

create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  -- reserva_confirmada · nueva_reserva_docente · reserva_cancelada · reembolso_realizado
  kind text not null,
  booking_id uuid references public.bookings (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  status email_status not null default 'pendiente',
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  payload jsonb not null default '{}'::jsonb,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  -- Un mismo aviso de una misma reserva a una misma persona se anota una sola vez.
  constraint email_outbox_event_key unique (kind, booking_id, recipient_id)
);

create index email_outbox_open_idx
  on public.email_outbox (created_at)
  where status in ('pendiente', 'fallido');

alter table public.email_outbox enable row level security;
revoke all on public.email_outbox from anon, authenticated;

-- 2. Qué lleva la foto de una reserva ---------------------------------------------------------------------------------------
--
-- Nombres, materia (solo si el docente da una sola), horario y precio. Los datos que no existen se omiten.
-- Ayudante interno de los triggers: no lo ejecuta ninguna sesión de la API.

create function public.email_booking_payload(p_booking public.bookings)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select jsonb_strip_nulls(jsonb_build_object(
        'student_name', nullif(btrim(st.full_name), ''),
        'tutor_name', nullif(btrim(tu.full_name), ''),
        'subject', (
          select case when count(*) = 1 then min(s.name) end
          from public.tutor_subjects ts
          join public.subjects s on s.id = ts.subject_id
          where ts.tutor_id = p_booking.tutor_id),
        'starts_at', p_booking.starts_at,
        'ends_at', p_booking.ends_at,
        'price', p_booking.price))
     from public.profiles st, public.profiles tu
     where st.id = p_booking.student_id and tu.id = p_booking.tutor_id),
    '{}'::jsonb);
$$;

revoke all on function public.email_booking_payload(public.bookings) from public, anon, authenticated;

-- 3. Triggers: cuándo se encola cada email -----------------------------------------------------------------------------------
--
-- Los tres están envueltos en un bloque con `exception when others`: un problema al anotar el email
-- (un dato raro, una tabla bloqueada) jamás hace fallar la confirmación, la cancelación ni el reembolso.

-- 3a. La reserva queda confirmada (el pago se registró antes que el cambio de estado):
--     «reserva_confirmada» para el alumno y «nueva_reserva_docente» para el docente.
create function public.enqueue_confirmed_booking_emails()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base jsonb := '{}'::jsonb;
  v_payment public.payments%rowtype;
begin
  begin
    v_base := public.email_booking_payload(new);
    select * into v_payment from public.payments where booking_id = new.id;

    insert into public.email_outbox (kind, booking_id, recipient_id, payload)
    values
      ('reserva_confirmada', new.id, new.student_id,
        jsonb_strip_nulls(v_base || jsonb_build_object('amount_paid', v_payment.amount))),
      ('nueva_reserva_docente', new.id, new.tutor_id,
        jsonb_strip_nulls(v_base || jsonb_build_object(
          'amount_paid', v_payment.amount, 'tutor_amount', v_payment.tutor_amount)))
    on conflict (kind, booking_id, recipient_id) do nothing;
  exception when others then
    raise warning 'No se pudo anotar el email de la reserva confirmada %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

create trigger bookings_enqueue_confirmed_emails
  after update of status on public.bookings
  for each row
  when (new.status = 'confirmada' and old.status is distinct from new.status)
  execute function public.enqueue_confirmed_booking_emails();

-- 3b. Se cancela una reserva que estaba confirmada (o sea, paga): «reserva_cancelada» para las dos partes.
--     Quién canceló se deduce de la sesión; sin sesión de alumno ni de docente (por ejemplo, desde el SQL
--     Editor) cuenta como la administración. Al alumno se le suma el reembolso que `cancel_booking` ya encoló.
create function public.enqueue_cancelled_booking_emails()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base jsonb := '{}'::jsonb;
  v_uid uuid := auth.uid();
  v_by text;
  v_payment public.payments%rowtype;
  v_refund public.refunds%rowtype;
begin
  begin
    v_base := public.email_booking_payload(new);
    v_by := case
      when v_uid is not null and v_uid = new.student_id then 'alumno'
      when v_uid is not null and v_uid = new.tutor_id then 'docente'
      else 'administracion'
    end;

    select * into v_payment from public.payments where booking_id = new.id;
    select * into v_refund from public.refunds where booking_id = new.id order by created_at limit 1;

    insert into public.email_outbox (kind, booking_id, recipient_id, payload)
    values
      ('reserva_cancelada', new.id, new.student_id,
        jsonb_strip_nulls(v_base || jsonb_build_object(
          'cancelled_by', v_by,
          'reason', new.cancellation_reason,
          'amount_paid', v_payment.amount,
          'refund_percent', case when v_payment.id is not null then coalesce(v_refund.percent, 0) end,
          'refund_amount', case when v_payment.id is not null then coalesce(v_refund.amount, 0) end))),
      ('reserva_cancelada', new.id, new.tutor_id,
        jsonb_strip_nulls(v_base || jsonb_build_object(
          'cancelled_by', v_by,
          'reason', new.cancellation_reason)))
    on conflict (kind, booking_id, recipient_id) do nothing;
  exception when others then
    raise warning 'No se pudo anotar el email de la reserva cancelada %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

create trigger bookings_enqueue_cancelled_emails
  after update of status on public.bookings
  for each row
  when (old.status = 'confirmada' and new.status = 'cancelada')
  execute function public.enqueue_cancelled_booking_emails();

-- 3c. Se aprueba un reembolso de una reserva: «reembolso_realizado» para el alumno. `reason` es
--     «cancelacion» o «pago_no_aceptable» (un pago que no se pudo aceptar y se devolvió solo).
create function public.enqueue_approved_refund_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings%rowtype;
begin
  begin
    select * into v_booking from public.bookings where id = new.booking_id;

    if found then
      insert into public.email_outbox (kind, booking_id, recipient_id, payload)
      values (
        'reembolso_realizado',
        v_booking.id,
        v_booking.student_id,
        jsonb_strip_nulls(public.email_booking_payload(v_booking) || jsonb_build_object(
          'refund_amount', new.amount,
          'refund_percent', new.percent,
          'reason', case when starts_with(new.reason, 'pago_no_aceptable') then 'pago_no_aceptable' else 'cancelacion' end)))
      on conflict (kind, booking_id, recipient_id) do nothing;
    end if;
  exception when others then
    raise warning 'No se pudo anotar el email del reembolso %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

create trigger refunds_enqueue_approved_email
  after update of status on public.refunds
  for each row
  when (new.status = 'aprobado' and old.status is distinct from new.status and new.booking_id is not null)
  execute function public.enqueue_approved_refund_email();

-- 4. Reclamar los emails por enviar (solo backend) -----------------------------------------------------------------------------------
--
-- Devuelve un arreglo JSON de { id, kind, attempts, to_email, to_name, payload } con hasta `p_limit` filas
-- (más viejas primero) en estado pendiente o fallido, con menos de 5 intentos y sin intento en los últimos
-- 5 minutos. Al reclamarlas suma un intento y anota la hora: si el proceso se cae a mitad de camino, el
-- reintento llega recién a los 5 minutos. `attempts` es el número de intento que se está haciendo ahora.
-- Las filas cuyo destinatario no tiene email (`auth.users.email`) pasan a «omitido» y no se devuelven.
-- `for update skip locked`: dos procesos al mismo tiempo no reclaman la misma fila.

create function public.claim_pending_emails(p_limit integer default 20)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
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

-- 5. Anotar el resultado (solo backend) --------------------------------------------------------------------------------------------------
--
-- `p_status`: enviado · fallido · omitido (otro valor: hint `invalid_status`; fila inexistente: `not_found`).
-- Idempotente: una fila ya enviada u omitida no cambia, así que repetir la llamada, o una respuesta que
-- llega tarde, no la hace volver atrás. El detalle del error se recorta a 500 caracteres y se le tapa
-- cualquier dirección de email que contenga, para que no queden datos personales en la bandeja.

create function public.mark_email_result(p_id uuid, p_status text, p_error text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.email_status;
begin
  if p_status is null or p_status not in ('enviado', 'fallido', 'omitido') then
    raise exception 'Estado inválido.' using hint = 'invalid_status';
  end if;

  select status into v_current
  from public.email_outbox
  where id = p_id
  for update;

  if not found then
    raise exception 'No encontramos ese email.' using hint = 'not_found';
  end if;

  if v_current in ('enviado', 'omitido') then
    return;
  end if;

  update public.email_outbox
  set status = p_status::public.email_status,
      sent_at = case when p_status = 'enviado' then now() else sent_at end,
      last_error = case
        when p_status = 'enviado' then null
        else left(regexp_replace(p_error, '[[:alnum:]._%+-]+@[[:alnum:].-]+', '[email]', 'g'), 500)
      end
  where id = p_id;
end;
$$;

revoke all on function public.mark_email_result(uuid, text, text) from public, anon, authenticated;
grant execute on function public.mark_email_result(uuid, text, text) to service_role;

-- 6. Los triggers no se llaman a mano ------------------------------------------------------------------------------------------------------

revoke all on function public.enqueue_confirmed_booking_emails() from public, anon, authenticated;
revoke all on function public.enqueue_cancelled_booking_emails() from public, anon, authenticated;
revoke all on function public.enqueue_approved_refund_email() from public, anon, authenticated;
