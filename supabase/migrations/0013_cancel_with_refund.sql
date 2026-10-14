-- 0013 · Cancelar con reembolso (Fase 1, paso 1.6).
--
-- Hasta la 0012, `cancel_booking` rechazaba las reservas ya pagas (hint `refund_required`) porque
-- no había quién devolviera la plata. Ahora la devolución se decide acá, en la base, y se encola
-- para que el servidor la ejecute contra Mercado Pago:
--
--   · cancel_booking        calcula el reembolso con `refund_percent` (la política de la 0011), lo
--                           encola con `enqueue_refund` y devuelve un resumen para mostrarle a la
--                           persona cuánto recibe. Dos cancelaciones simultáneas no encolan dos
--                           reembolsos (bloquea la reserva y el pago).
--   · refunds.mp_user_id    la cuenta de cobro de Mercado Pago que recibió el pago, o sea de quien
--                           se reembolsa (el servidor usa el token de ESA cuenta). Es un identificador
--                           de cuenta, no una credencial: los participantes de la reserva lo ven junto
--                           al resto de la fila (los tokens siguen solo en `mp_credentials`).
--   · enqueue_refund        recibe esa cuenta (parámetro nuevo, opcional).
--   · apply_payment_notification  pasa la cuenta de cobro del aviso al encolar un reembolso.
--   · retryable_refunds     lista, para el barrido del servidor, los reembolsos pendientes o
--                           fallidos que conviene reintentar.
--
-- SUPUESTO A VERIFICAR EN SANDBOX: que Mercado Pago acepte el reembolso con el token del docente
-- que cobró (si exigiera el de la plataforma, solo cambia qué token usa el servidor).
--
-- Requiere 0001 a 0012. Cambia el tipo de lo que devuelve `cancel_booking` (de void a jsonb), así
-- que la app tiene que desplegarse junto con esta migración.

-- 1. El reembolso sabe de qué cuenta de cobro sale -----------------------------------------------------

alter table public.refunds
  add column mp_user_id text;

-- Se agrega la clave `mp_user_id` al resumen que devuelven las funciones de reembolso.
create or replace function public.refund_summary(r public.refunds)
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
    'idempotency_key', r.idempotency_key,
    'mp_user_id', r.mp_user_id
  );
$$;

revoke all on function public.refund_summary(public.refunds) from public, anon, authenticated;

-- 2. enqueue_refund con la cuenta de cobro ----------------------------------------------------------------
--
-- Mismo comportamiento que en la 0012 (un solo reembolso por pago; repetir devuelve el que existe con
-- `created` = false) más el séptimo parámetro. Una llamada con seis argumentos sigue funcionando.

drop function public.enqueue_refund(text, uuid, uuid, integer, numeric, text);

create function public.enqueue_refund(
  p_mp_payment_id text,
  p_booking_id uuid,
  p_payment_id uuid,
  p_percent integer,
  p_amount numeric,
  p_reason text,
  p_mp_user_id text default null
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

  insert into public.refunds
    (booking_id, payment_id, mercadopago_payment_id, percent, amount, reason, mp_user_id)
  values
    (p_booking_id, p_payment_id, p_mp_payment_id, p_percent, p_amount, p_reason, nullif(btrim(p_mp_user_id), ''))
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

revoke all on function public.enqueue_refund(text, uuid, uuid, integer, numeric, text, text)
  from public, anon, authenticated;
grant execute on function public.enqueue_refund(text, uuid, uuid, integer, numeric, text, text)
  to service_role;

-- 3. apply_payment_notification pasa la cuenta de cobro -------------------------------------------------
--
-- Igual que en la 0012 (mismos resultados); lo único que cambia es la última llamada: el reembolso del
-- pago que no se puede aceptar queda con la cuenta de cobro que recibió la plata. En ese punto la cuenta
-- ya se comprobó (existe y es la del docente de la reserva), así que es de confianza.

create or replace function public.apply_payment_notification(
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
    p_mp_payment_id, v_booking.id, null, 100, p_amount, 'pago_no_aceptable:' || v_reason, p_collector_id);
  return jsonb_build_object(
    'outcome', case when (v_enq ->> 'created')::boolean then 'reembolso_encolado' else 'reembolso_existente' end,
    'detail', v_reason,
    'refund', v_enq - 'created');
end;
$$;

revoke all on function public.apply_payment_notification(text, uuid, text, numeric, text, text, numeric)
  from public, anon, authenticated;
grant execute on function public.apply_payment_notification(text, uuid, text, numeric, text, text, numeric)
  to service_role;

-- 4. Cancelar una reserva, con reembolso ----------------------------------------------------------------------
--
-- Reemplaza a la de la 0008. Las mismas validaciones y los mismos códigos de error en `hint`
-- (not_authenticated, not_found, not_cancellable, already_started); desaparece `refund_required`.
--
-- Devuelve un resumen para mostrar en pantalla y para que el servidor sepa si tiene que ejecutar un reembolso:
--
--   { "paid":         la reserva tenía un pago aprobado,
--     "percent":      porcentaje que corresponde devolver (política de `refund_percent`),
--     "amount":       monto a devolver, redondeado a centavos como `refundAmount` en TypeScript,
--     "refund":       la fila encolada en `refunds` (o null si no hay nada que devolver),
--     "cancelled_by": "alumno" | "docente" | "administracion" }
--
-- Si cancela el alumno rige la política por anticipación; si cancela el docente o la administración, siempre
-- se devuelve el 100 %. Una reserva sin pago aprobado se cancela como antes (paid = false, sin reembolso).
-- Un pago sin identificador de Mercado Pago no se puede reembolsar: la cancelación entera se rechaza
-- (hint `invalid_payment`) en vez de dejar la plata sin devolver.
--
-- Concurrencia: la reserva y el pago se bloquean (`for update`), así que dos cancelaciones simultáneas
-- se ordenan entre sí y la segunda recibe `not_cancellable`. Además, `enqueue_refund` es único por pago.

drop function public.cancel_booking(uuid, text);

create function public.cancel_booking(p_booking_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_booking public.bookings%rowtype;
  v_payment public.payments%rowtype;
  v_by text;
  v_by_label text;
  v_percent integer := 0;
  v_amount numeric(10, 2) := 0;
  v_refund jsonb := null;
  v_enq jsonb;
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

  if v_booking.student_id = v_uid then
    v_by := 'alumno';
    v_by_label := 'el alumno';
  elsif v_booking.tutor_id = v_uid then
    v_by := 'docente';
    v_by_label := 'el docente';
  else
    v_by := 'administracion';
    v_by_label := 'la administración';
  end if;

  select * into v_payment
  from public.payments
  where booking_id = v_booking.id and status = 'aprobado'
  for update;

  if found then
    v_percent := public.refund_percent(v_booking.starts_at, now(), v_by <> 'alumno');
    v_amount := round(v_payment.amount * v_percent / 100, 2);

    -- El reembolso se encola ANTES de marcar la reserva como cancelada: el aviso por email que dispara el
    -- cambio de estado (0015) ya lo encuentra.
    if v_percent > 0 and v_amount > 0 then
      v_enq := public.enqueue_refund(
        v_payment.mercadopago_payment_id,
        v_booking.id,
        v_payment.id,
        v_percent,
        v_amount,
        'cancelacion_' || v_by,
        (select c.mp_user_id from public.mp_credentials c where c.tutor_id = v_booking.tutor_id));

      -- Ese pago ya tenía un reembolso (un pago se reembolsa una sola vez): vale ese, y es lo que se informa.
      if not (v_enq ->> 'created')::boolean then
        v_percent := (v_enq ->> 'percent')::integer;
        v_amount := (v_enq ->> 'amount')::numeric;
      end if;
      v_refund := v_enq - 'created';
    end if;
  end if;

  update public.bookings
  set status = 'cancelada',
      cancellation_reason = left(
        coalesce(nullif(trim(p_reason), ''), 'Cancelada por ' || v_by_label),
        500
      )
  where id = v_booking.id;

  -- El horario vuelve a estar libre si todavía no pasó.
  update public.availability_slots
  set is_booked = false
  where id = v_booking.slot_id
    and starts_at > now();

  return jsonb_build_object(
    'paid', v_payment.id is not null,
    'percent', v_percent,
    'amount', v_amount,
    'refund', v_refund,
    'cancelled_by', v_by
  );
end;
$$;

revoke all on function public.cancel_booking(uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_booking(uuid, text) to authenticated;

-- 5. Reembolsos para reintentar --------------------------------------------------------------------------------
--
-- Para el barrido del servidor (un reembolso pudo fallar de forma pasajera o quedar con resultado
-- incierto). Devuelve un arreglo JSON de `refund_summary` más `tutor_id` (el docente de la reserva, o null)
-- con `mp_user_id` resuelto: el de la fila, o si no tiene, el de la cuenta de cobro vinculada al docente.
--
--   · estado pendiente o fallido, con menos de 8 intentos;
--   · sin tocar en los últimos 2 minutos (así no pisa al que acaba de encolarse y se está ejecutando);
--   · del más viejo al más nuevo.
--
-- Solo lee. La idempotencia la da la clave de cada fila: reintentar un reembolso que en realidad ya se hizo
-- devuelve la operación original y no devuelve dos veces.

create function public.retryable_refunds(p_limit integer default 25)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(x.item order by x.created_at, x.id), '[]'::jsonb)
  from (
    select
      r.id,
      r.created_at,
      public.refund_summary(r) || jsonb_build_object(
        'mp_user_id', coalesce(r.mp_user_id, c.mp_user_id),
        'tutor_id', b.tutor_id
      ) as item
    from public.refunds r
    left join public.bookings b on b.id = r.booking_id
    left join public.mp_credentials c on c.tutor_id = b.tutor_id
    where r.status in ('pendiente', 'fallido')
      and r.attempts < 8
      and r.updated_at <= now() - interval '2 minutes'
    order by r.created_at, r.id
    limit greatest(coalesce(p_limit, 25), 0)
  ) x;
$$;

revoke all on function public.retryable_refunds(integer) from public, anon, authenticated;
grant execute on function public.retryable_refunds(integer) to service_role;
