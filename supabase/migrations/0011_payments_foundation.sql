-- EstudiApp — Cimientos del cobro con Mercado Pago (Fase 1, paso 1.1).
--
-- Esta migración NO conecta con Mercado Pago ni cambia lo que puede hacer un alumno: deja en la base
-- las reglas y las tablas sobre las que se construye el cobro, para que el código de la aplicación
-- solo orqueste.
--
--   1. Comisión de la plataforma: `commission_rate_for(docente)` (12 % hoy) y la «foto» de esa tasa en
--      cada reserva. Si más adelante la comisión baja según la reputación del docente, las reservas ya
--      hechas no cambian.
--   2. `confirm_booking_payment` pasa a validar la comisión contra esa foto (antes aceptaba cualquier
--      valor entre 0 y el monto).
--   3. Política de reembolsos como función: `refund_percent()`.
--   4. `refunds`: cola de reembolsos con clave de idempotencia (la ejecuta el backend) y
--      `mark_refund_result()` para registrar el resultado.
--   5. `mp_credentials`: los tokens que Mercado Pago le da a cada docente al vincular su cuenta. Solo
--      lee y escribe la service role.
--   6. `begin_payment_event()` / `finish_payment_event()`: avisos (webhooks) idempotentes.
--
-- `cancel_booking` NO cambia acá: una reserva paga sigue sin poder cancelarse hasta que exista el
-- ejecutor de reembolsos (migración 0012, junto con él).
--
-- Requiere 0001 a 0010.

-- 1. Comisión ---------------------------------------------------------------------------------------
--
-- Hoy es 12 % para todos. Más adelante esta función leerá la reputación del docente (tabla de
-- escalones) sin que cambie nada de lo que la usa.

create function public.commission_rate_for(p_tutor uuid)
returns numeric(5, 4)
language sql
stable
set search_path = public
as $$
  select 0.1200::numeric(5, 4);
$$;

-- Comisión en pesos de un monto, redondeada a centavos.
create function public.booking_commission(p_amount numeric, p_rate numeric)
returns numeric(10, 2)
language sql
immutable
as $$
  select round(p_amount * p_rate, 2)::numeric(10, 2);
$$;

alter table public.bookings
  add column commission_rate numeric(5, 4);

-- Las reservas que ya existen toman la tasa vigente.
update public.bookings
set commission_rate = public.commission_rate_for(tutor_id)
where commission_rate is null;

alter table public.bookings
  alter column commission_rate set not null,
  add constraint bookings_commission_rate_range check (commission_rate >= 0 and commission_rate < 1);

-- Toda reserva nueva guarda la tasa del momento en que se crea, venga de donde venga.
create function public.set_booking_commission()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.commission_rate is null then
    new.commission_rate := public.commission_rate_for(new.tutor_id);
  end if;
  return new;
end;
$$;

create trigger bookings_set_commission
  before insert on public.bookings
  for each row execute function public.set_booking_commission();

-- 2. Confirmar el pago, ahora validando la comisión -------------------------------------------------------
--
-- Mismos códigos de error que antes, más `commission_mismatch`. Si no se informa comisión
-- (`p_commission` nulo) se usa la de la reserva. Reemplaza a la de 0008: cambia el valor por defecto
-- del cuarto parámetro, así que se borra y se vuelve a crear con sus permisos.

drop function public.confirm_booking_payment(uuid, text, numeric, numeric);

create function public.confirm_booking_payment(
  p_booking_id uuid,
  p_provider_payment_id text,
  p_amount numeric,
  p_commission numeric default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings%rowtype;
  v_payment public.payments%rowtype;
  v_commission numeric(10, 2);
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

  v_commission := public.booking_commission(p_amount, v_booking.commission_rate);

  if p_commission is not null and p_commission <> v_commission then
    raise exception 'La comisión no coincide con la acordada para esta reserva.' using hint = 'commission_mismatch';
  end if;

  insert into public.payments
    (booking_id, mercadopago_payment_id, status, amount, commission_amount, tutor_amount)
  values
    (v_booking.id, p_provider_payment_id, 'aprobado', p_amount, v_commission, p_amount - v_commission)
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

revoke all on function public.confirm_booking_payment(uuid, text, numeric, numeric)
  from public, anon, authenticated;
grant execute on function public.confirm_booking_payment(uuid, text, numeric, numeric)
  to service_role;

-- 3. Política de reembolsos --------------------------------------------------------------------------------
--
-- 100 % con 24 h o más de anticipación · 50 % con menos de 24 h y 2 h o más · 0 % con menos de 2 h.
-- Si cancela el docente o la administración, siempre 100 %.
-- Los casos límite están en supabase/tests/fixtures/refund-policy-cases.json y los comprueban esta
-- función y su espejo en TypeScript (src/lib/bookings/refund-policy.ts).

create function public.refund_percent(
  p_starts_at timestamptz,
  p_at timestamptz default now(),
  p_tutor_or_admin boolean default false
)
returns integer
language sql
immutable
as $$
  select case
    when p_tutor_or_admin then 100
    when p_starts_at - p_at >= interval '24 hours' then 100
    when p_starts_at - p_at >= interval '2 hours' then 50
    else 0
  end;
$$;

-- 4. Reembolsos ---------------------------------------------------------------------------------------------
--
-- Cada fila es UN reembolso de UN pago de Mercado Pago. Se crea desde la base (al cancelar una reserva
-- paga o al rechazar un pago que no se puede aceptar) y la ejecuta el backend contra Mercado Pago
-- usando `idempotency_key`, así que reintentar nunca devuelve la plata dos veces.
-- `mercadopago_payment_id` es único: un pago se reembolsa una sola vez.

alter table public.payments
  add column refunded_amount numeric(10, 2) not null default 0,
  add constraint payments_refunded_range check (refunded_amount >= 0 and refunded_amount <= amount);

create type refund_status as enum ('pendiente', 'aprobado', 'fallido');

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.bookings (id) on delete set null,
  payment_id uuid references public.payments (id) on delete set null,
  mercadopago_payment_id text not null unique,
  percent integer not null check (percent between 0 and 100),
  amount numeric(10, 2) not null check (amount > 0),
  reason text not null,
  status refund_status not null default 'pendiente',
  mercadopago_refund_id text unique,
  idempotency_key uuid not null default gen_random_uuid() unique,
  attempts integer not null default 0,
  failure_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index refunds_open_idx on public.refunds (created_at) where status <> 'aprobado';

create trigger refunds_set_updated_at
  before update on public.refunds
  for each row execute function public.set_updated_at();

alter table public.refunds enable row level security;

-- Cada parte ve los reembolsos de sus propias reservas. Escribir: solo la service role.
create policy "refunds_select_participant_or_admin"
  on public.refunds for select
  using (
    public.is_admin()
    or exists (
      select 1 from public.bookings b
      where b.id = refunds.booking_id
        and (b.student_id = auth.uid() or b.tutor_id = auth.uid())
    )
  );

revoke all on public.refunds from anon;
revoke insert, update, delete on public.refunds from authenticated;

-- Registra cómo terminó un intento de reembolso. Es idempotente: si el reembolso ya estaba aprobado
-- no hace nada. Al aprobarse, el pago guarda cuánto se devolvió y se recalcula lo que le queda al
-- docente y a la plataforma sobre lo RETENIDO (la comisión se mantiene proporcional).
create function public.mark_refund_result(
  p_refund_id uuid,
  p_status refund_status,
  p_mp_refund_id text default null,
  p_detail text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_refund public.refunds%rowtype;
  v_pay public.payments%rowtype;
  v_refunded numeric(10, 2);
  v_retained numeric(10, 2);
  v_commission numeric(10, 2);
begin
  if p_status = 'pendiente' then
    raise exception 'Estado inválido.' using hint = 'invalid_status';
  end if;

  select * into v_refund from public.refunds where id = p_refund_id for update;

  if not found then
    raise exception 'No encontramos ese reembolso.' using hint = 'not_found';
  end if;

  if v_refund.status = 'aprobado' then
    return;
  end if;

  update public.refunds
  set status = p_status,
      mercadopago_refund_id = coalesce(p_mp_refund_id, mercadopago_refund_id),
      failure_detail = case when p_status = 'fallido' then left(p_detail, 500) else null end,
      attempts = attempts + 1
  where id = p_refund_id;

  if p_status = 'aprobado' and v_refund.payment_id is not null then
    select * into v_pay from public.payments where id = v_refund.payment_id for update;

    v_refunded := least(v_pay.amount, v_pay.refunded_amount + v_refund.amount);
    v_retained := v_pay.amount - v_refunded;
    v_commission := round(v_retained * v_pay.commission_amount / nullif(v_pay.amount, 0), 2);

    update public.payments
    set refunded_amount = v_refunded,
        commission_amount = coalesce(v_commission, 0),
        tutor_amount = v_retained - coalesce(v_commission, 0),
        status = case when v_refunded >= v_pay.amount then 'reembolsado' else v_pay.status end
    where id = v_pay.id;
  end if;
end;
$$;

revoke all on function public.mark_refund_result(uuid, refund_status, text, text)
  from public, anon, authenticated;
grant execute on function public.mark_refund_result(uuid, refund_status, text, text) to service_role;

-- 5. Credenciales de Mercado Pago de cada docente -------------------------------------------------------
--
-- Los tokens que Mercado Pago entrega al vincular la cuenta (OAuth). `access_token` vale 180 días y
-- `refresh_token`, 6 meses: hay que renovarlos antes de que venzan. La aplicación los guarda CIFRADOS
-- (AES-GCM) antes de escribirlos acá. Ni el docente ni nadie con una sesión de la API puede leerlos:
-- la tabla no tiene políticas y se le quitan los permisos a `anon` y `authenticated`.

create table public.mp_credentials (
  tutor_id uuid primary key references public.tutor_profiles (id) on delete cascade,
  mp_user_id text not null unique,
  access_token text not null,
  refresh_token text not null,
  public_key text,
  expires_at timestamptz not null,
  live_mode boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger mp_credentials_set_updated_at
  before update on public.mp_credentials
  for each row execute function public.set_updated_at();

alter table public.mp_credentials enable row level security;
revoke all on public.mp_credentials from anon, authenticated;

-- 6. Avisos (webhooks) idempotentes ------------------------------------------------------------------------
--
-- Mercado Pago reintenta un aviso hasta que se le responde 200/201. `begin_payment_event` dice qué
-- hacer con cada llegada: 'nuevo' (procesar), 'reintento' (ya llegó pero falló antes: procesar de nuevo)
-- o 'duplicado' (ya se procesó bien: responder 200 y listo).

alter table public.payment_webhook_events
  add column processed_at timestamptz,
  add column process_error text,
  add column attempts integer not null default 0;

create function public.begin_payment_event(p_event_id text, p_payload jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer;
  v_processed timestamptz;
begin
  insert into public.payment_webhook_events (mercadopago_event_id, payload)
  values (p_event_id, p_payload)
  on conflict (mercadopago_event_id) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 1 then
    return 'nuevo';
  end if;

  select processed_at into v_processed
  from public.payment_webhook_events
  where mercadopago_event_id = p_event_id;

  return case when v_processed is not null then 'duplicado' else 'reintento' end;
end;
$$;

create function public.finish_payment_event(p_event_id text, p_error text default null)
returns void
language sql
security definer
set search_path = public
as $$
  update public.payment_webhook_events
  set processed_at = case when p_error is null then now() else processed_at end,
      process_error = left(p_error, 500),
      attempts = attempts + 1
  where mercadopago_event_id = p_event_id;
$$;

revoke all on function public.begin_payment_event(text, jsonb) from public, anon, authenticated;
revoke all on function public.finish_payment_event(text, text) from public, anon, authenticated;
grant execute on function public.begin_payment_event(text, jsonb) to service_role;
grant execute on function public.finish_payment_event(text, text) to service_role;

-- 7. Funciones de ayuda: solo para usuarios con sesión y el backend ------------------------------------------

revoke all on function public.commission_rate_for(uuid) from public, anon;
revoke all on function public.booking_commission(numeric, numeric) from public, anon;
revoke all on function public.refund_percent(timestamptz, timestamptz, boolean) from public, anon;
grant execute on function public.commission_rate_for(uuid) to authenticated, service_role;
grant execute on function public.booking_commission(numeric, numeric) to authenticated, service_role;
grant execute on function public.refund_percent(timestamptz, timestamptz, boolean) to authenticated, service_role;
