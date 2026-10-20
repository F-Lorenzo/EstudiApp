-- 0014 · Cuentas de cobro de los docentes (Fase 1, paso 1.4).
--
-- Un docente cobra en su propia cuenta de Mercado Pago, que vincula por OAuth. Esta migración deja en
-- la base las reglas de esa vinculación; el servidor solo orquesta el intercambio con Mercado Pago:
--
--   · save_mp_credentials    guarda (o reemplaza) las credenciales del docente. Solo la service role.
--   · rotate_mp_tokens       renueva los tokens antes de que venzan, sin cambiar de cuenta. Solo la service role.
--   · unlink_my_mp_account   el docente desvincula su cuenta (no puede si tiene reservas por dar o
--                            reembolsos sin cerrar).
--   · tutor_can_receive_payments  si un docente tiene una cuenta vigente.
--   · create_booking         desde ahora no se puede reservar con un docente que no puede recibir pagos.
--
-- Los tokens llegan ya CIFRADOS desde la aplicación (AES-GCM, `src/lib/payments/token-crypto.ts`): estas
-- funciones nunca los interpretan ni los devuelven, y la tabla `mp_credentials` sigue sin ser legible
-- desde ninguna sesión de la API (migración 0011).
--
-- ATENCIÓN AL APLICARLA: desde esta migración `create_booking` rechaza (`tutor_not_payable`) a todo
-- docente sin cuenta vinculada. En un proyecto con docentes aprobados y reservas abiertas, aplicala
-- después de vincular al menos un docente de prueba (si no, nadie puede reservar hasta que vinculen).
--
-- Requiere 0001 a 0013.

-- Compatibilidad con instalaciones creadas antes de que los reembolsos guardaran la cuenta receptora.
-- La columna permite mantener bloqueada una cuenta aunque la reserva asociada ya no esté disponible.
alter table public.refunds
  add column if not exists mp_user_id text;

update public.refunds r
set mp_user_id = c.mp_user_id
from public.bookings b
join public.mp_credentials c on c.tutor_id = b.tutor_id
where r.booking_id = b.id
  and r.mp_user_id is null;

create index if not exists refunds_mp_user_open_idx
  on public.refunds (mp_user_id)
  where status <> 'aprobado';

-- 1. Lo que impide cambiar o soltar la cuenta ---------------------------------------------------------------
--
-- Mientras haya plata en camino con la cuenta actual, no se la puede soltar ni cambiar por otra:
--   · reservas por dar (pendiente de pago, o confirmada que todavía no empezó): el cobro y un posible
--     reembolso se hacen con el token de esa cuenta;
--   · reembolsos sin cerrar (pendientes o fallidos) de sus reservas o de pagos que entraron a su cuenta.
-- Devuelve el código del impedimento (el mismo `hint` que usan las funciones) o null si no hay ninguno.
-- Es un ayudante interno: no lo ejecuta ninguna sesión de la API.

create function public.mp_account_blocker(p_tutor uuid)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when exists (
      select 1 from public.bookings b
      where b.tutor_id = p_tutor
        and (b.status = 'pendiente_pago' or (b.status = 'confirmada' and b.starts_at > now()))
    ) then 'has_active_bookings'
    when exists (
      select 1
      from public.refunds r
      left join public.bookings b on b.id = r.booking_id
      where r.status <> 'aprobado'
        and (
          b.tutor_id = p_tutor
          or r.mp_user_id = (select c.mp_user_id from public.mp_credentials c where c.tutor_id = p_tutor)
        )
    ) then 'has_pending_refunds'
    else null
  end;
$$;

revoke all on function public.mp_account_blocker(uuid) from public, anon, authenticated;

-- 2. Guardar las credenciales (solo backend) ------------------------------------------------------------------
--
-- Errores (en `hint`):
--   not_a_tutor            el usuario no tiene perfil de docente
--   invalid_credentials    faltan datos (cuenta o tokens vacíos) o los tokens ya vencieron
--   account_already_linked esa cuenta de Mercado Pago ya está vinculada a OTRO docente
--   has_active_bookings /
--   has_pending_refunds    el docente ya tenía OTRA cuenta vinculada y todavía tiene plata en camino con ella
--
-- Vincular de nuevo la MISMA cuenta (para renovar permisos) siempre se puede. Todo en una transacción:
-- las credenciales y `tutor_private.mercadopago_account_id` quedan juntas o no queda nada.

create function public.save_mp_credentials(
  p_tutor_id uuid,
  p_mp_user_id text,
  p_access_token text,
  p_refresh_token text,
  p_public_key text,
  p_expires_at timestamptz,
  p_live_mode boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current text;
  v_blocker text;
begin
  if p_tutor_id is null or not exists (select 1 from public.tutor_profiles where id = p_tutor_id) then
    raise exception 'Esa cuenta no es de un docente.' using hint = 'not_a_tutor';
  end if;

  if p_mp_user_id is null or btrim(p_mp_user_id) = ''
     or p_access_token is null or btrim(p_access_token) = ''
     or p_refresh_token is null or btrim(p_refresh_token) = ''
     or p_expires_at is null or p_expires_at <= now() then
    raise exception 'Las credenciales de Mercado Pago no son válidas.' using hint = 'invalid_credentials';
  end if;

  -- Ordena esta operación con las reservas nuevas del docente y con su desvinculación.
  perform pg_advisory_xact_lock(hashtext('mp_account:' || p_tutor_id::text));

  select mp_user_id into v_current from public.mp_credentials where tutor_id = p_tutor_id;
  if found and v_current <> p_mp_user_id then
    v_blocker := public.mp_account_blocker(p_tutor_id);
    if v_blocker = 'has_active_bookings' then
      raise exception 'No se puede cambiar de cuenta con reservas por dar.' using hint = 'has_active_bookings';
    elsif v_blocker = 'has_pending_refunds' then
      raise exception 'No se puede cambiar de cuenta con reembolsos sin cerrar.' using hint = 'has_pending_refunds';
    end if;
  end if;

  begin
    insert into public.mp_credentials
      (tutor_id, mp_user_id, access_token, refresh_token, public_key, expires_at, live_mode)
    values
      (p_tutor_id, p_mp_user_id, p_access_token, p_refresh_token, p_public_key, p_expires_at, coalesce(p_live_mode, false))
    on conflict (tutor_id) do update
      set mp_user_id = excluded.mp_user_id,
          access_token = excluded.access_token,
          refresh_token = excluded.refresh_token,
          public_key = excluded.public_key,
          expires_at = excluded.expires_at,
          live_mode = excluded.live_mode;
  exception when unique_violation then
    -- `mp_credentials.mp_user_id` es único: la cuenta ya es de otro docente.
    raise exception 'Esa cuenta de Mercado Pago ya está vinculada a otro docente.'
      using hint = 'account_already_linked';
  end;

  insert into public.tutor_private (id, mercadopago_account_id)
  values (p_tutor_id, p_mp_user_id)
  on conflict (id) do update set mercadopago_account_id = excluded.mercadopago_account_id;
end;
$$;

revoke all on function public.save_mp_credentials(uuid, text, text, text, text, timestamptz, boolean)
  from public, anon, authenticated;
grant execute on function public.save_mp_credentials(uuid, text, text, text, text, timestamptz, boolean)
  to service_role;

-- 3. Renovar los tokens (solo backend) -------------------------------------------------------------------------------
--
-- Mercado Pago entrega tokens nuevos al renovar. No cambia la cuenta (`mp_user_id`) ni lo demás.
--   not_linked           el docente no tiene credenciales
--   invalid_credentials  tokens vacíos o ya vencidos

create function public.rotate_mp_tokens(
  p_tutor_id uuid,
  p_access_token text,
  p_refresh_token text,
  p_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_access_token is null or btrim(p_access_token) = ''
     or p_refresh_token is null or btrim(p_refresh_token) = ''
     or p_expires_at is null or p_expires_at <= now() then
    raise exception 'Las credenciales de Mercado Pago no son válidas.' using hint = 'invalid_credentials';
  end if;

  update public.mp_credentials
  set access_token = p_access_token,
      refresh_token = p_refresh_token,
      expires_at = p_expires_at
  where tutor_id = p_tutor_id;

  if not found then
    raise exception 'Este docente no tiene una cuenta de Mercado Pago vinculada.' using hint = 'not_linked';
  end if;
end;
$$;

revoke all on function public.rotate_mp_tokens(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.rotate_mp_tokens(uuid, text, text, timestamptz) to service_role;

-- 4. Desvincular mi cuenta ----------------------------------------------------------------------------------------------
--
-- Lo llama el propio docente (usa su sesión). Errores (en `hint`):
--   not_authenticated, not_linked, has_active_bookings, has_pending_refunds
-- Borra las credenciales y deja `tutor_private.mercadopago_account_id` vacío.

create function public.unlink_my_mp_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_blocker text;
begin
  if v_uid is null then
    raise exception 'Necesitás iniciar sesión.' using hint = 'not_authenticated';
  end if;

  -- Ordena esta operación con las reservas nuevas del docente (create_booking toma el mismo candado).
  perform pg_advisory_xact_lock(hashtext('mp_account:' || v_uid::text));

  if not exists (select 1 from public.mp_credentials where tutor_id = v_uid) then
    raise exception 'No tenés una cuenta de Mercado Pago vinculada.' using hint = 'not_linked';
  end if;

  v_blocker := public.mp_account_blocker(v_uid);
  if v_blocker = 'has_active_bookings' then
    raise exception 'Tenés reservas por dar: no podés desvincular tu cuenta todavía.' using hint = 'has_active_bookings';
  elsif v_blocker = 'has_pending_refunds' then
    raise exception 'Hay reembolsos sin cerrar: no podés desvincular tu cuenta todavía.' using hint = 'has_pending_refunds';
  end if;

  delete from public.mp_credentials where tutor_id = v_uid;

  update public.tutor_private
  set mercadopago_account_id = null
  where id = v_uid;
end;
$$;

revoke all on function public.unlink_my_mp_account() from public, anon, authenticated;
grant execute on function public.unlink_my_mp_account() to authenticated;

-- 5. ¿Puede el docente recibir pagos? ---------------------------------------------------------------------------------------
--
-- Verdadero si tiene credenciales que no vencieron. Devuelve solo un sí o un no: no deja leer
-- `mp_credentials` (security definer), por eso la puede ejecutar cualquiera, incluso sin sesión.

create function public.tutor_can_receive_payments(p_tutor uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.mp_credentials
    where tutor_id = p_tutor and expires_at > now()
  );
$$;

revoke all on function public.tutor_can_receive_payments(uuid) from public;
grant execute on function public.tutor_can_receive_payments(uuid) to anon, authenticated, service_role;

-- 6. create_booking exige que el docente pueda recibir pagos ---------------------------------------------------------------------
--
-- Igual que la de la 0008 más un chequeo nuevo, DESPUÉS de comprobar que el docente está disponible:
--   tutor_not_payable   el docente todavía no vinculó su cuenta de cobro, o sus credenciales vencieron
-- Toma el mismo candado que `save_mp_credentials` y `unlink_my_mp_account` (en modo compartido): una
-- reserva nueva y una desvinculación no pueden cruzarse sin verse.

create or replace function public.create_booking(p_slot_id uuid)
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

  -- ...y tiene que poder cobrar: sin cuenta de Mercado Pago vigente, el alumno no tendría dónde pagar.
  perform pg_advisory_xact_lock_shared(hashtext('mp_account:' || v_slot.tutor_id::text));

  if not public.tutor_can_receive_payments(v_slot.tutor_id) then
    raise exception 'Este docente todavía no puede recibir pagos.' using hint = 'tutor_not_payable';
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

revoke all on function public.create_booking(uuid) from public, anon, authenticated;
grant execute on function public.create_booking(uuid) to authenticated;
