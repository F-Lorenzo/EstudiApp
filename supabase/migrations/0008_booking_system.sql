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
--   sync_bookings()               libera las reservas sin pagar a tiempo y
--                                 completa las clases que ya terminaron.
--   confirm_booking_payment(...)  SOLO service_role (webhook de pago).
--
-- Todavía NO se aplicó a ningún proyecto de Supabase. Requiere 0001 a 0007 y
-- conviene aplicar también 0009, que cierra cómo se crea un perfil de docente.

-- 1. Una reserva cancelada no debe bloquear el horario para siempre -----------
--
-- `slot_id` era unique: aunque se cancelara la reserva, el horario no se podía
-- volver a reservar. Pasa a ser único solo entre reservas no canceladas.

alter table public.bookings drop constraint bookings_slot_id_key;

create unique index bookings_active_slot_key
  on public.bookings (slot_id)
  where status <> 'cancelada';

-- 2. La reserva guarda su propio horario y precio -----------------------------
--
-- Cuando se cancela una reserva el horario vuelve a estar libre y el docente
-- puede cerrarlo (borrar la franja). Antes, ese borrado se llevaba puesta la
-- reserva cancelada y todo lo que colgaba de ella. Ahora la reserva conserva su
-- horario y el vínculo con la franja se corta (`on delete set null`).
--
-- Con el precio pasa lo mismo: si el docente cambia su tarifa después, la
-- reserva ya hecha no cambia.

alter table public.bookings
  add column starts_at timestamptz,
  add column ends_at timestamptz,
  add column price numeric(10, 2);

update public.bookings b
set starts_at = s.starts_at,
    ends_at = s.ends_at
from public.availability_slots s
where s.id = b.slot_id;

alter table public.bookings
  alter column starts_at set not null,
  alter column ends_at set not null,
  add constraint bookings_valid_range check (ends_at > starts_at);

alter table public.bookings drop constraint bookings_slot_id_fkey;
alter table public.bookings alter column slot_id drop not null;
alter table public.bookings
  add constraint bookings_slot_id_fkey
  foreign key (slot_id) references public.availability_slots (id) on delete set null;

-- Para el barrido de `sync_bookings()`.
create index bookings_pending_created_idx
  on public.bookings (created_at)
  where status = 'pendiente_pago';

create index bookings_confirmed_end_idx
  on public.bookings (ends_at)
  where status = 'confirmada';

-- 3. Las reservas ya no se escriben directamente desde la API -----------------
--
-- Tampoco la administración: corregir una reserva a mano dejaba el horario y el
-- pago desincronizados. Si hace falta, se corrige desde el SQL Editor.

drop policy "bookings_insert_own_student" on public.bookings;
drop policy "bookings_update_participant_or_admin" on public.bookings;

-- 4. Qué ve cada parte de la reserva --------------------------------------------
--
-- El alumno tiene que seguir viendo a su docente (nombre, foto, materias) aunque
-- la administración lo deje de aprobar después de reservar. El docente, el
-- nombre y la foto de quienes le reservaron.

create policy "tutor_profiles_select_booked_by_student"
  on public.tutor_profiles for select
  using (
    exists (
      select 1 from public.bookings b
      where b.tutor_id = tutor_profiles.id and b.student_id = auth.uid()
    )
  );

create policy "tutor_subjects_select_booked_by_student"
  on public.tutor_subjects for select
  using (
    exists (
      select 1 from public.bookings b
      where b.tutor_id = tutor_subjects.tutor_id and b.student_id = auth.uid()
    )
  );

create policy "profiles_select_tutor_booked_by_student"
  on public.profiles for select
  using (
    exists (
      select 1 from public.bookings b
      where b.tutor_id = profiles.id and b.student_id = auth.uid()
    )
  );

create policy "profiles_select_student_of_tutor"
  on public.profiles for select
  using (
    exists (
      select 1 from public.bookings b
      where b.student_id = profiles.id and b.tutor_id = auth.uid()
    )
  );

-- 5. Mantenimiento de reservas ----------------------------------------------------
--
-- Una reserva «pendiente_pago» retiene el horario durante 15 minutos. Pasado
-- ese tiempo se cancela y el horario vuelve a estar libre. Una reserva
-- «confirmada» pasa a «completada» cuando termina la clase.
--
-- La app la ejecuta antes de leer o mostrar horarios y reservas (también para
-- visitantes sin sesión, por eso se concede a `anon`: solo cierra lo que ya
-- venció, no recibe parámetros). Si querés que además corra sola, podés
-- programarla con pg_cron (por ejemplo, cada minuto).
--
-- `skip locked`: si una confirmación de pago está en curso sobre una reserva,
-- el barrido la deja pasar en lugar de esperar o pisarla.

create function public.sync_bookings()
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
    and ends_at < now();

  return v_freed;
end;
$$;

-- 6. Crear una reserva ----------------------------------------------------------
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

  -- Las reservas de un mismo alumno se ordenan entre sí: sin esto, dos pedidos
  -- simultáneos (dos pestañas, doble clic) no se verían y podrían pasar el
  -- control de superposición y el tope de reservas sin pagar.
  perform pg_advisory_xact_lock(hashtext('create_booking:' || v_uid::text));

  perform public.sync_bookings();

  -- Bloquea la fila del horario: dos alumnos distintos se ordenan acá.
  select * into v_slot
  from public.availability_slots
  where id = p_slot_id
  for update;

  if not found then
    raise exception 'Ese horario no existe.' using hint = 'slot_not_found';
  end if;

  -- Idempotente: si el alumno ya tiene este horario, devuelve esa reserva (por
  -- ejemplo si vuelve atrás en el navegador y aprieta de nuevo «Reservar»).
  select id into v_booking
  from public.bookings
  where slot_id = p_slot_id
    and student_id = v_uid
    and status in ('pendiente_pago', 'confirmada');

  if found then
    return v_booking;
  end if;

  if v_slot.is_booked then
    raise exception 'Ese horario ya fue reservado.' using hint = 'slot_taken';
  end if;

  if v_slot.starts_at < now() + interval '1 hour' then
    raise exception 'Ese horario ya no está disponible para reservar.' using hint = 'slot_too_soon';
  end if;

  -- El docente tiene que estar aprobado y ser realmente un docente.
  select tp.tarifa_por_clase into v_price
  from public.tutor_profiles tp
  join public.profiles p on p.id = tp.id
  where tp.id = v_slot.tutor_id
    and tp.verification_status = 'aprobado'
    and p.role = 'docente';

  if not found then
    raise exception 'Este docente no está disponible.' using hint = 'tutor_unavailable';
  end if;

  -- Sin tope, una sola cuenta podría retener todos los horarios sin pagar.
  if (
    select count(*) from public.bookings
    where student_id = v_uid and status = 'pendiente_pago'
  ) >= 2 then
    raise exception 'Ya tenés reservas sin pagar.' using hint = 'too_many_holds';
  end if;

  -- El mismo alumno no puede tener dos clases que se pisan.
  if exists (
    select 1
    from public.bookings b
    where b.student_id = v_uid
      and b.status in ('pendiente_pago', 'confirmada')
      and b.starts_at < v_slot.ends_at
      and b.ends_at > v_slot.starts_at
  ) then
    raise exception 'Ya tenés una clase en ese horario.' using hint = 'student_overlap';
  end if;

  insert into public.bookings (student_id, tutor_id, slot_id, status, price, starts_at, ends_at)
  values (v_uid, v_slot.tutor_id, v_slot.id, 'pendiente_pago', v_price, v_slot.starts_at, v_slot.ends_at)
  returning id into v_booking;

  update public.availability_slots
  set is_booked = true
  where id = v_slot.id;

  return v_booking;
end;
$$;

-- 7. Cancelar una reserva ---------------------------------------------------------
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

  if v_booking.status = 'confirmada' and v_booking.starts_at <= now() then
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

-- 8. Confirmar el pago (solo backend) --------------------------------------------
--
-- Lo llama el webhook de Mercado Pago con la service role key. Es idempotente:
-- repetir el mismo pago no hace nada. Todo lo demás que no sea un pago válido
-- para una reserva vigente devuelve un error con su código en `hint`, siempre
-- el mismo, sin depender de si alguien ejecutó antes `sync_bookings()`:
--
--   not_found          la reserva no existe
--   not_pending        ya estaba cancelada o completada
--   hold_expired       pasaron los 15 minutos
--   class_started      la clase ya empezó
--   amount_mismatch    el monto no es el precio acordado
--   invalid_commission la comisión es negativa o mayor que el monto
--   duplicate_payment  la reserva ya estaba paga con OTRO pago
--
-- En cualquier error, el webhook tiene que reembolsar el pago recibido.

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
  v_payment public.payments%rowtype;
begin
  select * into v_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if not found then
    raise exception 'No encontramos esa reserva.' using hint = 'not_found';
  end if;

  if v_booking.status = 'confirmada' then
    select * into v_payment
    from public.payments
    where booking_id = v_booking.id and status = 'aprobado';

    if found then
      if v_payment.mercadopago_payment_id is not distinct from p_provider_payment_id then
        return;
      end if;
      raise exception 'La reserva ya estaba paga con otro pago.' using hint = 'duplicate_payment';
    end if;
  end if;

  if v_booking.status <> 'pendiente_pago' then
    raise exception 'La reserva ya no está pendiente de pago.' using hint = 'not_pending';
  end if;

  if v_booking.created_at < now() - interval '15 minutes' then
    raise exception 'La reserva venció antes de recibir el pago.' using hint = 'hold_expired';
  end if;

  if v_booking.starts_at <= now() then
    raise exception 'La clase ya empezó.' using hint = 'class_started';
  end if;

  if p_amount is null or (v_booking.price is not null and p_amount <> v_booking.price) then
    raise exception 'El monto no coincide con el precio de la clase.' using hint = 'amount_mismatch';
  end if;

  if p_commission is null or p_commission < 0 or p_commission > p_amount then
    raise exception 'La comisión no es válida.' using hint = 'invalid_commission';
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

-- 9. Quién puede ejecutar cada función --------------------------------------------

revoke all on function public.sync_bookings() from public, anon, authenticated;
revoke all on function public.create_booking(uuid) from public, anon, authenticated;
revoke all on function public.cancel_booking(uuid, text) from public, anon, authenticated;
revoke all on function public.confirm_booking_payment(uuid, text, numeric, numeric)
  from public, anon, authenticated;

grant execute on function public.sync_bookings() to anon, authenticated, service_role;
grant execute on function public.create_booking(uuid) to authenticated;
grant execute on function public.cancel_booking(uuid, text) to authenticated;
grant execute on function public.confirm_booking_payment(uuid, text, numeric, numeric)
  to service_role;
