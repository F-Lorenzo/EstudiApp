-- 0012 · Avisos de pago de Mercado Pago: qué hacer con cada pago.
--
-- El servidor recibe el aviso (webhook), consulta el pago en Mercado Pago y le pasa a la base lo que
-- ahí figura. La DECISIÓN vive acá, en una sola transacción y con pruebas (supabase/tests/payment-notifications.db.mjs):
--
--   · pago aprobado y aceptable      → la reserva queda confirmada (confirm_booking_payment)
--   · pago aprobado que NO se puede aceptar (vencido, reserva cancelada, duplicado, monto o moneda
--     distintos, clase empezada, reserva inexistente) → se encola el reembolso del 100 %
--   · pendiente / rechazado          → no cambia nada (la reserva sigue pendiente y puede reintentar)
--   · reembolsado / contracargo hecho por fuera de la app → se marca «requiere_revision», sin tocar plata
--   · el mismo pago otra vez, o avisos fuera de orden → no hacen nada (siempre se actúa sobre el
--     estado real del pago, no sobre el orden en que llegaron los avisos)
--
-- Todo es idempotente: repetir un aviso nunca confirma dos veces ni reembolsa dos veces
-- (refunds.mercadopago_payment_id es único: un pago tiene como máximo un reembolso).

create function public.refund_summary(r public.refunds)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'id', r.id,
    'booking_id', r.booking_id,
    'mercadopago_payment_id', r.mercadopago_payment_id,
    'status', r.status,
    'percent', r.percent,
    'amount', r.amount,
    'idempotency_key', r.idempotency_key
  );
$$;

-- Encola un reembolso para un pago de Mercado Pago. Si ese pago ya tiene reembolso, devuelve el que
-- existe (`created` = false) en vez de crear otro: así dos avisos simultáneos no reembolsan dos veces.
create function public.enqueue_refund(
  p_mp_payment_id text,
  p_booking_id uuid,
  p_payment_id uuid,
  p_percent integer,
  p_amount numeric,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_refund public.refunds%rowtype;
  v_created boolean := false;
begin
  if p_mp_payment_id is null or btrim(p_mp_payment_id) = '' then
    raise exception 'Falta el pago a reembolsar.' using hint = 'invalid_payment';
  end if;

  insert into public.refunds (booking_id, payment_id, mercadopago_payment_id, percent, amount, reason)
  values (p_booking_id, p_payment_id, p_mp_payment_id, p_percent, p_amount, p_reason)
  on conflict (mercadopago_payment_id) do nothing
  returning * into v_refund;

  if found then
    v_created := true;
  else
    select * into v_refund from public.refunds where mercadopago_payment_id = p_mp_payment_id;
  end if;

  return public.refund_summary(v_refund) || jsonb_build_object('created', v_created);
end;
$$;

create function public.apply_payment_notification(
  p_mp_payment_id text,
  p_booking_id uuid,
  p_status text,
  p_amount numeric,
  p_currency text,
  p_collector_id text,
  p_refunded_amount numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay public.payments%rowtype;
  v_refund public.refunds%rowtype;
  v_booking public.bookings%rowtype;
  v_enq jsonb;
  v_hint text;
  v_reason text;
begin
  if p_mp_payment_id is null or btrim(p_mp_payment_id) = '' or p_status is null then
    raise exception 'Faltan datos del pago.' using hint = 'invalid_notification';
  end if;

  select * into v_pay from public.payments where mercadopago_payment_id = p_mp_payment_id;
  select * into v_refund from public.refunds where mercadopago_payment_id = p_mp_payment_id;

  -- Un reembolso nuestro quedó sin confirmar (la respuesta se perdió) pero Mercado Pago ya devolvió
  -- el monto: se da por hecho. Es la forma de «curar» un reembolso de resultado incierto.
  if v_refund.id is not null
     and v_refund.status <> 'aprobado'
     and coalesce(p_refunded_amount, 0) >= v_refund.amount then
    perform public.mark_refund_result(v_refund.id, 'aprobado', null, null);
    select * into v_refund from public.refunds where id = v_refund.id;
    return jsonb_build_object('outcome', 'reembolso_confirmado', 'refund', public.refund_summary(v_refund));
  end if;

  -- Reembolso o contracargo.
  if p_status in ('refunded', 'charged_back') then
    if v_refund.id is not null then
      return jsonb_build_object('outcome', 'reembolso_existente', 'refund', public.refund_summary(v_refund));
    end if;
    if v_pay.id is not null then
      return jsonb_build_object(
        'outcome', 'requiere_revision',
        'detail', case p_status when 'charged_back' then 'contracargo' else 'reembolso_externo' end);
    end if;
    return jsonb_build_object('outcome', 'ignorado', 'detail', 'sin_registro');
  end if;

  -- El pago ya fue aceptado antes: repetir el aviso, o recibirlo fuera de orden, no cambia nada.
  if v_pay.id is not null then
    if p_booking_id is not null and p_booking_id is distinct from v_pay.booking_id then
      return jsonb_build_object('outcome', 'requiere_revision', 'detail', 'referencia_distinta');
    end if;
    return jsonb_build_object(
      'outcome', case when v_pay.status = 'reembolsado' then 'ya_reembolsada' else 'ya_confirmada' end);
  end if;

  -- Pago que ya se había mandado a reembolsar (no aceptable): no se vuelve a evaluar.
  if v_refund.id is not null then
    return jsonb_build_object('outcome', 'reembolso_existente', 'refund', public.refund_summary(v_refund));
  end if;

  -- Todavía no se acreditó, o no se va a acreditar: no hay nada que hacer en la reserva.
  if p_status in ('pending', 'in_process', 'authorized', 'in_mediation') then
    return jsonb_build_object('outcome', 'pendiente', 'detail', p_status);
  end if;
  if p_status in ('rejected', 'cancelled') then
    return jsonb_build_object('outcome', 'rechazada', 'detail', p_status);
  end if;
  if p_status <> 'approved' then
    return jsonb_build_object('outcome', 'requiere_revision', 'detail', 'estado_desconocido:' || left(p_status, 40));
  end if;

  -- A partir de acá el pago está aprobado.
  if p_booking_id is null then
    return jsonb_build_object('outcome', 'ignorado', 'detail', 'sin_referencia');
  end if;

  -- La plata tiene que haber entrado a una cuenta de cobro vinculada, y si la reserva existe, a la
  -- de SU docente. Si no, no se confirma ni se reembolsa: lo mira una persona.
  if p_collector_id is null
     or not exists (select 1 from public.mp_credentials where mp_user_id = p_collector_id) then
    return jsonb_build_object('outcome', 'requiere_revision', 'detail', 'cuenta_desconocida');
  end if;

  select * into v_booking from public.bookings where id = p_booking_id;

  if v_booking.id is not null
     and not exists (
       select 1 from public.mp_credentials
       where tutor_id = v_booking.tutor_id and mp_user_id = p_collector_id) then
    return jsonb_build_object('outcome', 'requiere_revision', 'detail', 'cuenta_distinta');
  end if;

  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('outcome', 'requiere_revision', 'detail', 'monto_invalido');
  end if;

  -- Aprobado pero ya devuelto en parte por fuera de la app: no se confirma sobre un pago modificado.
  if coalesce(p_refunded_amount, 0) > 0 then
    return jsonb_build_object('outcome', 'requiere_revision', 'detail', 'reembolso_externo');
  end if;

  if v_booking.id is null then
    v_reason := 'reserva_inexistente';
  elsif p_currency is distinct from 'ARS' then
    v_reason := 'moneda';
  else
    begin
      perform public.confirm_booking_payment(v_booking.id, p_mp_payment_id, p_amount);
      return jsonb_build_object('outcome', 'confirmada', 'booking_id', v_booking.id);
    exception when others then
      get stacked diagnostics v_hint = pg_exception_hint;
      -- Solo los rechazos «de negocio» de la confirmación se reembolsan; cualquier otro error (la
      -- base caída, un bug) se propaga para que el aviso se reintente.
      if v_hint is null or v_hint not in
         ('not_pending', 'hold_expired', 'class_started', 'amount_mismatch', 'duplicate_payment') then
        raise;
      end if;
      v_reason := v_hint;
    end;
  end if;

  v_enq := public.enqueue_refund(
    p_mp_payment_id, v_booking.id, null, 100, p_amount, 'pago_no_aceptable:' || v_reason);
  return jsonb_build_object(
    'outcome', case when (v_enq ->> 'created')::boolean then 'reembolso_encolado' else 'reembolso_existente' end,
    'detail', v_reason,
    'refund', v_enq - 'created');
end;
$$;

revoke all on function public.refund_summary(public.refunds) from public, anon, authenticated;
revoke all on function public.enqueue_refund(text, uuid, uuid, integer, numeric, text) from public, anon, authenticated;
revoke all on function public.apply_payment_notification(text, uuid, text, numeric, text, text, numeric)
  from public, anon, authenticated;
grant execute on function public.enqueue_refund(text, uuid, uuid, integer, numeric, text) to service_role;
grant execute on function public.apply_payment_notification(text, uuid, text, numeric, text, text, numeric)
  to service_role;
