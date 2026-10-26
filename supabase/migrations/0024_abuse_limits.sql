-- 0024 — Límites contra el abuso (Fase 4, ítem 3).
--
-- Decisiones del 26 de octubre de 2026:
--   · Pago con tarjeta: hasta 5 intentos por reserva y 10 por alumno en 24 horas, sumando todas sus reservas.
--     Sin tope, una persona con una reserva pendiente podía probar tarjetas robadas una tras otra durante los
--     15 minutos de la retención, y eso puede costarle la cuenta de Mercado Pago al docente.
--   · Reservas: hasta 10 reservas sin pagar que vencieron o se cancelaron en 24 horas por alumno. El tope de 2
--     sin pagar a la vez (0008) no impedía dejarlas vencer y crear otras sin fin, ocupando los horarios de un
--     docente. Las reservas pagas no cuentan.
--
--   · card_payment_attempts     un registro por intento de cobro con tarjeta. Solo lo usa el backend.
--   · register_card_attempt     la llama el servidor justo ANTES de pedirle el cobro a Mercado Pago: si se pasó
--                               del tope, no se intenta (hints `too_many_card_attempts_booking` y
--                               `too_many_card_attempts`). Cuenta el intento aunque después Mercado Pago no
--                               responda: del lado de la app no se puede saber si la tarjeta llegó a probarse.
--   · limit_daily_holds         trigger antes de crear una reserva sin pagar (hint `too_many_daily_holds`). Va
--                               como trigger para que valga por cualquier camino, no solo `create_booking`.
--
-- Requiere 0001 a 0023.

-- 1. Intentos de pago con tarjeta -------------------------------------------------------------------------------------

create table public.card_payment_attempts (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index card_payment_attempts_booking_idx on public.card_payment_attempts (booking_id);
create index card_payment_attempts_student_idx on public.card_payment_attempts (student_id, created_at);

alter table public.card_payment_attempts enable row level security;
revoke all on public.card_payment_attempts from anon, authenticated;

create function public.register_card_attempt(p_booking uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student uuid;
begin
  -- Bloquea la reserva: dos intentos simultáneos de la misma reserva se ordenan acá y no pasan juntos el tope.
  select b.student_id into v_student
  from public.bookings b
  where b.id = p_booking
  for update;

  if not found then
    raise exception 'No encontramos esa reserva.' using hint = 'not_found';
  end if;

  -- Y los de un mismo alumno en reservas distintas, acá.
  perform pg_advisory_xact_lock(hashtext('card_attempt:' || v_student::text));

  if (select count(*) from public.card_payment_attempts a where a.booking_id = p_booking) >= 5 then
    raise exception 'Ya hiciste 5 intentos de pago para esta reserva.' using hint = 'too_many_card_attempts_booking';
  end if;

  if (select count(*) from public.card_payment_attempts a
      where a.student_id = v_student and a.created_at > now() - interval '24 hours') >= 10 then
    raise exception 'Hiciste demasiados intentos de pago hoy.' using hint = 'too_many_card_attempts';
  end if;

  insert into public.card_payment_attempts (booking_id, student_id) values (p_booking, v_student);
end;
$$;

revoke all on function public.register_card_attempt(uuid) from public, anon, authenticated;
grant execute on function public.register_card_attempt(uuid) to service_role;

-- 2. Reservas sin pagar por día ------------------------------------------------------------------------------------------

create function public.limit_daily_holds()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'pendiente_pago' then
    return new;
  end if;

  if (
    select count(*)
    from public.bookings b
    where b.student_id = new.student_id
      and b.created_at > now() - interval '24 hours'
      and b.status = 'cancelada'
      and not exists (
        select 1 from public.payments p
        where p.booking_id = b.id and p.status in ('aprobado', 'reembolsado'))
  ) >= 10 then
    raise exception 'Hoy ya dejaste vencer o cancelaste muchas reservas sin pagar.' using hint = 'too_many_daily_holds';
  end if;

  return new;
end;
$$;

revoke all on function public.limit_daily_holds() from public, anon, authenticated;

create trigger bookings_limit_daily_holds
  before insert on public.bookings
  for each row execute function public.limit_daily_holds();
