-- 0017 — La clase se completa según la asistencia a la sala (Fase 2, ítem 4).
--
-- Decisión del 25 de octubre de 2026:
--   · Una persona asistió si estuvo 10 minutos o más en la videollamada (sumando todas sus entradas).
--   · Si el docente asistió, la clase cuenta como dada («completada»), haya entrado el alumno o no.
--   · Si el docente NO asistió, la reserva se cancela por su ausencia y al alumno se le devuelve el 100 %.
--
-- Los minutos los informa el servidor de la app a partir de Daily.co (solo service role). La base decide:
--   · con el docente presente 10 minutos, la clase se completa en cuanto termina su horario;
--   · la ausencia del docente recién se da por cierta cuando la sala se cerró (10 minutos después del final),
--     porque hasta ese momento todavía podía entrar.
--
-- Hasta ahora `sync_bookings` completaba toda clase confirmada al terminar su horario, sin mirar nada. Ahora
-- eso queda como red de seguridad: si en 3 días no se pudo registrar la asistencia (Daily sin configurar o
-- caído), la clase se completa igual. Así una falla de Daily nunca devuelve plata por sí sola.

-- 1. Asistencia registrada ------------------------------------------------------------------------------------

create table public.class_attendance (
  booking_id uuid primary key references public.bookings (id) on delete cascade,
  tutor_seconds integer not null check (tutor_seconds >= 0),
  student_seconds integer not null check (student_seconds >= 0),
  outcome text not null check (outcome in ('completada', 'docente_ausente')),
  recorded_at timestamptz not null default now()
);

alter table public.class_attendance enable row level security;
revoke all on public.class_attendance from anon, authenticated;
grant select on public.class_attendance to authenticated;

-- La ven las dos partes de la clase y la administración. Nadie la escribe desde la API.
create policy "class_attendance_select_parties_or_admin"
  on public.class_attendance for select
  using (
    public.is_admin()
    or exists (
      select 1 from public.bookings b
      where b.id = class_attendance.booking_id
        and (b.student_id = auth.uid() or b.tutor_id = auth.uid())
    )
  );

-- 2. Registrar la asistencia y decidir ------------------------------------------------------------------------
--
-- Devuelve:
--   { "outcome": "pendiente" }                 todavía no se puede decidir (no se escribe nada)
--   { "outcome": "completada", ... }           la clase quedó completada
--   { "outcome": "docente_ausente", "paid", "percent", "amount", "refund", "cancelled_by" }
--                                              cancelada con reembolso del 100 % (misma forma que cancel_booking)
-- Si la asistencia ya estaba registrada, devuelve lo registrado sin cambiar nada (idempotente).

create function public.record_class_attendance(
  p_booking_id uuid,
  p_tutor_seconds integer,
  p_student_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_min_seconds constant integer := 600;
  v_room_grace constant interval := interval '10 minutes';
  v_booking public.bookings%rowtype;
  v_existing public.class_attendance%rowtype;
  v_payment public.payments%rowtype;
  v_percent integer := 0;
  v_amount numeric(10, 2) := 0;
  v_refund jsonb := null;
  v_enq jsonb;
begin
  if p_tutor_seconds is null or p_student_seconds is null or p_tutor_seconds < 0 or p_student_seconds < 0 then
    raise exception 'La asistencia no es válida.' using hint = 'invalid_attendance';
  end if;

  select * into v_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if not found then
    raise exception 'No encontramos esa reserva.' using hint = 'not_found';
  end if;

  select * into v_existing from public.class_attendance where booking_id = p_booking_id;
  if found then
    return jsonb_build_object('outcome', v_existing.outcome, 'already', true);
  end if;

  if v_booking.status <> 'confirmada' then
    raise exception 'La reserva no está confirmada.' using hint = 'not_confirmed';
  end if;

  if v_booking.ends_at > now() then
    return jsonb_build_object('outcome', 'pendiente');
  end if;

  -- El docente estuvo: la clase cuenta como dada.
  if p_tutor_seconds >= v_min_seconds then
    insert into public.class_attendance (booking_id, tutor_seconds, student_seconds, outcome)
    values (v_booking.id, p_tutor_seconds, p_student_seconds, 'completada');

    update public.bookings set status = 'completada' where id = v_booking.id;

    return jsonb_build_object('outcome', 'completada');
  end if;

  -- Todavía podía entrar: la sala sigue abierta.
  if v_booking.ends_at + v_room_grace > now() then
    return jsonb_build_object('outcome', 'pendiente');
  end if;

  -- El docente no se presentó: reembolso del 100 % y la reserva se cancela.
  insert into public.class_attendance (booking_id, tutor_seconds, student_seconds, outcome)
  values (v_booking.id, p_tutor_seconds, p_student_seconds, 'docente_ausente');

  select * into v_payment
  from public.payments
  where booking_id = v_booking.id and status = 'aprobado'
  for update;

  if found then
    v_percent := 100;
    v_amount := v_payment.amount;

    -- Como en cancel_booking: el reembolso se encola antes de cancelar, así el email de la cancelación (0015)
    -- ya lo encuentra.
    if v_amount > 0 then
      v_enq := public.enqueue_refund(
        v_payment.mercadopago_payment_id,
        v_booking.id,
        v_payment.id,
        v_percent,
        v_amount,
        'docente_ausente',
        (select c.mp_user_id from public.mp_credentials c where c.tutor_id = v_booking.tutor_id));

      if not (v_enq ->> 'created')::boolean then
        v_percent := (v_enq ->> 'percent')::integer;
        v_amount := (v_enq ->> 'amount')::numeric;
      end if;
      v_refund := v_enq - 'created';
    end if;
  end if;

  update public.bookings
  set status = 'cancelada',
      cancellation_reason = 'El docente no se presentó a la clase.'
  where id = v_booking.id;

  return jsonb_build_object(
    'outcome', 'docente_ausente',
    'paid', v_payment.id is not null,
    'percent', v_percent,
    'amount', v_amount,
    'refund', v_refund,
    'cancelled_by', 'administracion'
  );
end;
$$;

revoke all on function public.record_class_attendance(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.record_class_attendance(uuid, integer, integer) to service_role;

-- 3. Clases terminadas que esperan su asistencia --------------------------------------------------------------
--
-- Para el servidor: confirmadas cuyo horario ya terminó, de la más vieja a la más nueva.

create function public.classes_awaiting_attendance(p_limit integer default 25)
returns table (booking_id uuid, student_id uuid, tutor_id uuid, starts_at timestamptz, ends_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, b.student_id, b.tutor_id, b.starts_at, b.ends_at
  from public.bookings b
  where b.status = 'confirmada'
    and b.ends_at <= now()
    and not exists (select 1 from public.class_attendance a where a.booking_id = b.id)
  order by b.ends_at, b.id
  limit greatest(0, least(coalesce(p_limit, 25), 100));
$$;

revoke all on function public.classes_awaiting_attendance(integer) from public, anon, authenticated;
grant execute on function public.classes_awaiting_attendance(integer) to service_role;

-- 4. sync_bookings: «completada» ya no es automática al terminar -------------------------------------------------
--
-- Igual que en la 0008, salvo la última parte: una clase confirmada se completa sola recién 3 días después de
-- terminar, si para entonces no se pudo registrar su asistencia.

create or replace function public.sync_bookings()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_freed integer;
begin
  with expired as (
    select id
    from public.bookings
    where status = 'pendiente_pago'
      and created_at < now() - interval '15 minutes'
    for update skip locked
  ),
  cancelled as (
    update public.bookings b
    set status = 'cancelada',
        cancellation_reason = 'No se completó el pago a tiempo'
    from expired e
    where b.id = e.id
    returning b.slot_id
  )
  update public.availability_slots s
  set is_booked = false
  from cancelled c
  where s.id = c.slot_id;

  get diagnostics v_freed = row_count;

  update public.bookings
  set status = 'completada'
  where status = 'confirmada'
    and ends_at < now() - interval '3 days';

  return v_freed;
end;
$$;
