-- EstudiApp — Sistema de reservas.
--
-- Hasta acá cualquier alumno podía insertar una reserva con el estado y el
-- horario que quisiera (por ejemplo «confirmada» sin pagar), y cualquier
-- participante podía editarla. Ahora las reservas solo se crean y cambian
-- mediante funciones que validan todo del lado de la base:
--
--   create_booking(slot)          el alumno reserva un horario libre; queda
--                                 «pendiente_pago» y el horario, retenido.
--   cancel_booking(reserva, why)  alumno, docente o administración cancelan.
--   expire_pending_bookings()     libera las reservas sin pagar a tiempo.
--   confirm_booking_payment(...)  SOLO service_role (webhook de pago).
--
-- Todavía NO se aplicó a ningún proyecto de Supabase. Requiere 0001 a 0007.

-- 1. Una reserva cancelada no debe bloquear el horario para siempre -----------
--
-- `slot_id` era unique: aunque se cancelara la reserva, el horario no se podía
-- volver a reservar. Pasa a ser único solo entre reservas no canceladas.

alter table public.bookings drop constraint bookings_slot_id_key;

create unique index bookings_active_slot_key
  on public.bookings (slot_id)
  where status <> 'cancelada';

-- 2. Precio acordado -----------------------------------------------------------
--
-- Se guarda el precio vigente al reservar: si el docente cambia su tarifa
-- después, la reserva ya hecha no cambia.

alter table public.bookings
  add column price numeric(10, 2);

-- 3. Las reservas ya no se escriben directamente desde la API -----------------

drop policy "bookings_insert_own_student" on public.bookings;
drop policy "bookings_update_participant_or_admin" on public.bookings;

-- Administración sí puede corregir una reserva a mano.
create policy "bookings_update_admin"
  on public.bookings for update
  using (public.is_admin());

-- 4. Vencimiento de reservas sin pagar -----------------------------------------
--
-- Una reserva «pendiente_pago» retiene el horario durante 15 minutos. Pasado
-- ese tiempo se cancela y el horario vuelve a estar libre. Se ejecuta cada vez
-- que alguien reserva o consulta sus reservas; si querés que corra solo, podés
-- programarla con pg_cron (por ejemplo, cada minuto).

create function public.expire_pending_bookings()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_freed integer;
begin
  with expired as (
    update public.bookings
    set status = 'cancelada',
        cancellation_reason = 'No se completó el pago a tiempo'
    where status = 'pendiente_pago'
      and created_at < now() - interval '15 minutes'
    returning slot_id
  )
  update public.availability_slots s
  set is_booked = false
  from expired e
  where s.id = e.slot_id;

  get diagnostics v_freed = row_count;
  return v_freed;
end;
$$;

-- 5. Crear una reserva ----------------------------------------------------------
--
-- Los errores llevan un código legible por la app en `hint`.

create function public.create_booking(p_slot_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_slot public.availability_slots%rowtype;
  v_price numeric(10, 2);
  v_booking uuid;
begin
  if v_uid is null then
    raise exception 'Necesitás iniciar sesión para reservar.' using hint = 'not_authenticated';
  end if;

  if not exists (select 1 from public.profiles where id = v_uid and role = 'alumno') then
    raise exception 'Solo los alumnos pueden reservar clases.' using hint = 'not_student';
  end if;

  perform public.expire_pending_bookings();

  -- Bloquea la fila del horario: dos reservas simultáneas se ordenan acá.
  select * into v_slot
  from public.availability_slots
  where id = p_slot_id
  for update;

  if not found then
    raise exception 'Ese horario no existe.' using hint = 'slot_not_found';
  end if;

  if v_slot.is_booked then
    raise exception 'Ese horario ya fue reservado.' using hint = 'slot_taken';
  end if;

  if v_slot.starts_at < now() + interval '1 hour' then
    raise exception 'Ese horario ya no está disponible para reservar.' using hint = 'slot_too_soon';
  end if;

  select tarifa_por_clase into v_price
  from public.tutor_profiles
  where id = v_slot.tutor_id
    and verification_status = 'aprobado';

  if not found then
    raise exception 'Este docente no está disponible.' using hint = 'tutor_unavailable';
  end if;

  -- El mismo alumno no puede tener dos clases que se pisan.
  if exists (
    select 1
    from public.bookings b
    join public.availability_slots s on s.id = b.slot_id
    where b.student_id = v_uid
      and b.status in ('pendiente_pago', 'confirmada')
      and s.starts_at < v_slot.ends_at
      and s.ends_at > v_slot.starts_at
  ) then
    raise exception 'Ya tenés una clase en ese horario.' using hint = 'student_overlap';
  end if;

  insert into public.bookings (student_id, tutor_id, slot_id, status, price)
  values (v_uid, v_slot.tutor_id, v_slot.id, 'pendiente_pago', v_price)
  returning id into v_booking;

  update public.availability_slots
  set is_booked = true
  where id = v_slot.id;

  return v_booking;
end;
$$;

-- 6. Cancelar una reserva ---------------------------------------------------------
--
-- Una reserva ya pagada todavía no se puede cancelar desde acá: falta la lógica
-- de reembolso (tarjeta «Lógica de cancelación con reembolso»). Hasta
-- entonces la función lo rechaza en lugar de dejar un pago sin devolver.

create function public.cancel_booking(p_booking_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_booking public.bookings%rowtype;
  v_starts timestamptz;
  v_by text;
begin
  if v_uid is null then
    raise exception 'Necesitás iniciar sesión.' using hint = 'not_authenticated';
  end if;

  select * into v_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if not found
     or not (v_booking.student_id = v_uid or v_booking.tutor_id = v_uid or public.is_admin()) then
    raise exception 'No encontramos esa reserva.' using hint = 'not_found';
  end if;

  if v_booking.status not in ('pendiente_pago', 'confirmada') then
    raise exception 'Esta reserva ya no se puede cancelar.' using hint = 'not_cancellable';
  end if;

  select starts_at into v_starts
  from public.availability_slots
  where id = v_booking.slot_id;

  if v_booking.status = 'confirmada' and v_starts <= now() then
    raise exception 'La clase ya empezó.' using hint = 'already_started';
  end if;

  if exists (
    select 1 from public.payments
    where booking_id = v_booking.id and status = 'aprobado'
  ) then
    raise exception 'Esta reserva ya está paga: la cancelación con reembolso todavía no está disponible.'
      using hint = 'refund_required';
  end if;

  v_by := case
    when v_booking.student_id = v_uid then 'el alumno'
    when v_booking.tutor_id = v_uid then 'el docente'
    else 'la administración'
  end;

  update public.bookings
  set status = 'cancelada',
      cancellation_reason = left(
        coalesce(nullif(trim(p_reason), ''), 'Cancelada por ' || v_by),
        500
      )
  where id = v_booking.id;

  -- El horario vuelve a estar libre si todavía no pasó.
  update public.availability_slots
  set is_booked = false
  where id = v_booking.slot_id
    and starts_at > now();
end;
$$;

-- 7. Confirmar el pago (solo backend) --------------------------------------------
--
-- Lo llama el webhook de Mercado Pago con la service role key. Es idempotente:
-- si el pago ya estaba registrado no hace nada. Si la reserva ya venció o se
-- canceló, devuelve un error en lugar de confirmar una clase sin horario
-- retenido (en ese caso hay que reembolsar el pago).

create function public.confirm_booking_payment(
  p_booking_id uuid,
  p_provider_payment_id text,
  p_amount numeric,
  p_commission numeric default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings%rowtype;
begin
  select * into v_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if not found then
    raise exception 'No encontramos esa reserva.' using hint = 'not_found';
  end if;

  if v_booking.status = 'confirmada'
     and exists (select 1 from public.payments where booking_id = v_booking.id and status = 'aprobado') then
    return;
  end if;

  if v_booking.status <> 'pendiente_pago' then
    raise exception 'La reserva ya no está pendiente de pago.' using hint = 'not_pending';
  end if;

  insert into public.payments
    (booking_id, mercadopago_payment_id, status, amount, commission_amount, tutor_amount)
  values
    (v_booking.id, p_provider_payment_id, 'aprobado', p_amount, p_commission, p_amount - p_commission)
  on conflict (booking_id) do update
    set status = 'aprobado',
        mercadopago_payment_id = excluded.mercadopago_payment_id,
        amount = excluded.amount,
        commission_amount = excluded.commission_amount,
        tutor_amount = excluded.tutor_amount;

  update public.bookings
  set status = 'confirmada'
  where id = v_booking.id;
end;
$$;

-- 8. Quién puede ejecutar cada función --------------------------------------------

revoke all on function public.expire_pending_bookings() from public, anon, authenticated;
revoke all on function public.create_booking(uuid) from public, anon, authenticated;
revoke all on function public.cancel_booking(uuid, text) from public, anon, authenticated;
revoke all on function public.confirm_booking_payment(uuid, text, numeric, numeric)
  from public, anon, authenticated;

grant execute on function public.expire_pending_bookings() to authenticated, service_role;
grant execute on function public.create_booking(uuid) to authenticated;
grant execute on function public.cancel_booking(uuid, text) to authenticated;
grant execute on function public.confirm_booking_payment(uuid, text, numeric, numeric)
  to service_role;
