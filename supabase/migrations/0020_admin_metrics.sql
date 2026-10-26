-- 0020 — Métricas reales para la administración (Fase 3, ítem 2).
--
-- `admin_metrics(p_weeks)` calcula en la base todo lo que muestra /admin/metricas, para no traer todas las
-- reservas y pagos a la app. Solo la llama una cuenta de administración (hint `not_admin`). Las semanas son de
-- lunes a domingo en hora de Argentina; los «últimos 30 días» cuentan desde ahora.
--
-- Qué cuenta cada cifra (todo sobre pagos cobrados: «aprobado», o «reembolsado» si después se devolvió entero,
-- 0011; son los únicos que movieron plata):
--   · reservas pagas      pagos aprobados, por la fecha del pago.
--   · clases dadas        reservas «completada», por el día de la clase.
--   · ingresos            lo que pagaron los alumnos (bruto), por la fecha del pago.
--   · comisión            la comisión vigente de esos pagos: si hubo reembolso, ya está recalculada sobre lo
--                         que no se devolvió (0011), así que es neta de reembolsos.
--   · reembolsado         reembolsos aprobados, por la fecha en que se aprobaron.
--   · cancelaciones       reservas pagas canceladas; aparte, las ausencias del docente (0017) y las reservas
--                         que vencieron sin pagarse.
--   · docentes activos    aprobados que dieron al menos una clase en los últimos 30 días.
--   · alumnos activos     con al menos una reserva paga en los últimos 30 días.
--
-- Requiere 0001 a 0019.

create function public.admin_metrics(p_weeks integer default 8)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz constant text := 'America/Argentina/Buenos_Aires';
  v_weeks integer := greatest(1, least(coalesce(p_weeks, 8), 26));
  v_since timestamptz := now() - interval '30 days';
  v_first_week date;
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Solo la administración ve las métricas.' using hint = 'not_admin';
  end if;

  v_first_week := (date_trunc('week', now() at time zone v_tz))::date - (v_weeks - 1) * 7;

  with weeks as (
    select generate_series(v_first_week, (date_trunc('week', now() at time zone v_tz))::date, interval '1 week')::date as week
  ),
  paid as (
    select p.*, (date_trunc('week', p.created_at at time zone v_tz))::date as week
    from public.payments p
    where p.status in ('aprobado', 'reembolsado')
  ),
  given as (
    select (date_trunc('week', b.starts_at at time zone v_tz))::date as week
    from public.bookings b
    where b.status = 'completada'
  ),
  refunded as (
    select r.amount, (date_trunc('week', r.updated_at at time zone v_tz))::date as week
    from public.refunds r
    where r.status = 'aprobado'
  ),
  series as (
    select coalesce(jsonb_agg(jsonb_build_object(
        'week_start', w.week,
        'paid_bookings', (select count(*) from paid where paid.week = w.week),
        'classes_given', (select count(*) from given where given.week = w.week),
        'revenue', (select coalesce(sum(amount), 0) from paid where paid.week = w.week),
        'commission', (select coalesce(sum(commission_amount), 0) from paid where paid.week = w.week),
        'refunded', (select coalesce(sum(amount), 0) from refunded where refunded.week = w.week))
      order by w.week), '[]'::jsonb) as data
    from weeks w
  )
  select jsonb_build_object(
    'generated_at', now(),
    'weeks', (select data from series),
    'last_30_days', jsonb_build_object(
      'paid_bookings', (select count(*) from public.payments where status in ('aprobado', 'reembolsado') and created_at >= v_since),
      'classes_given', (select count(*) from public.bookings where status = 'completada' and starts_at >= v_since and starts_at <= now()),
      'revenue', (select coalesce(sum(amount), 0) from public.payments where status in ('aprobado', 'reembolsado') and created_at >= v_since),
      'commission', (select coalesce(sum(commission_amount), 0) from public.payments where status in ('aprobado', 'reembolsado') and created_at >= v_since),
      'tutor_amount', (select coalesce(sum(tutor_amount), 0) from public.payments where status in ('aprobado', 'reembolsado') and created_at >= v_since),
      'refunded', (select coalesce(sum(amount), 0) from public.refunds where status = 'aprobado' and updated_at >= v_since),
      'paid_cancellations', (
        select count(*) from public.bookings b
        where b.status = 'cancelada' and b.updated_at >= v_since
          and exists (select 1 from public.payments p where p.booking_id = b.id and p.status in ('aprobado', 'reembolsado'))),
      'tutor_absences', (
        select count(*) from public.class_attendance a
        where a.outcome = 'docente_ausente' and a.recorded_at >= v_since),
      'expired_holds', (
        select count(*) from public.bookings b
        where b.status = 'cancelada' and b.updated_at >= v_since
          and not exists (select 1 from public.payments p where p.booking_id = b.id and p.status in ('aprobado', 'reembolsado')))),
    'tutors', jsonb_build_object(
      'approved', (select count(*) from public.tutor_profiles where verification_status = 'aprobado'),
      'pending', (select count(*) from public.tutor_profiles where verification_status = 'pendiente'),
      'payable', (
        select count(*) from public.tutor_profiles tp
        where tp.verification_status = 'aprobado' and public.tutor_can_receive_payments(tp.id)),
      'active_30d', (
        select count(distinct b.tutor_id) from public.bookings b
        join public.tutor_profiles tp on tp.id = b.tutor_id and tp.verification_status = 'aprobado'
        where b.status = 'completada' and b.starts_at >= v_since and b.starts_at <= now())),
    'students', jsonb_build_object(
      'total', (select count(*) from public.profiles where role = 'alumno'),
      'active_30d', (
        select count(distinct b.student_id) from public.bookings b
        join public.payments p on p.booking_id = b.id and p.status in ('aprobado', 'reembolsado')
        where p.created_at >= v_since)),
    'ratings', jsonb_build_object(
      'count', (select count(*) from public.ratings),
      'average', (select round(avg(score)::numeric, 2) from public.ratings),
      'count_30d', (select count(*) from public.ratings where created_at >= v_since),
      'average_30d', (select round(avg(score)::numeric, 2) from public.ratings where created_at >= v_since)))
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.admin_metrics(integer) from public, anon;
grant execute on function public.admin_metrics(integer) to authenticated, service_role;
