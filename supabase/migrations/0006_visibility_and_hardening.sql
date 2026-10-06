-- EstudiApp — Visibilidad que necesita la interfaz y endurecimiento de la RLS.
--
-- Es aditiva: no modifica las migraciones 0001 a 0005. Todavía NO se aplicó a
-- ningún proyecto de Supabase: revisala y correla en el SQL Editor (o con
-- `supabase db push`) antes de usar la app con datos reales.
--
-- Qué resuelve:
--  1. El alumno no podía leer el horario de sus propias reservas (la RLS de
--     `availability_slots` solo deja ver horarios libres), así que «Mi
--     espacio», «Próximas clases» y «Historial» salían siempre vacíos.
--  2. La administración no podía leer las materias de un docente pendiente
--     (`tutor_subjects` solo era visible para docentes aprobados), así que la
--     ficha de revisión mostraba siempre «sin materias».
--  3. Cualquier usuario podía cambiarse el `role` a «administrador» con su
--     propia sesión (la política de UPDATE de `profiles` no restringe columnas).
--  4. Un docente podía aprobarse a sí mismo o cambiar su calificación y su
--     cuenta de Mercado Pago editando su propia fila de `tutor_profiles`.
--  5. Nada mantenía `tutor_profiles.rating_promedio` a partir de `ratings`.
--
-- Qué NO resuelve (queda documentado en CLAUDE.md): la política de SELECT
-- público de `tutor_profiles` es por fila y expone todas sus columnas
-- (`contacto_verificacion`, `credential_url`, `mercadopago_account_id`). Cerrar
-- eso exige mover esos datos a una tabla privada o a una vista, y cambiar las
-- consultas de la app.
--
-- Las funciones de guarda solo restringen a las sesiones que llegan por la API
-- (roles `authenticated` y `anon`). El SQL Editor, la service role key y los
-- scripts de mantenimiento (por ejemplo `seed:demo`) siguen funcionando igual.

-- 1. El alumno lee el horario de sus propias reservas ------------------------

create policy "availability_slots_select_own_booking_student"
  on public.availability_slots for select
  using (
    exists (
      select 1 from public.bookings b
      where b.slot_id = availability_slots.id
        and b.student_id = auth.uid()
    )
  );

-- 2. La administración lee las materias de cualquier docente ------------------

create policy "tutor_subjects_select_admin"
  on public.tutor_subjects for select
  using (public.is_admin());

-- 3. Nadie (salvo administración) puede cambiar un rol desde la API -----------

create function public.protect_profile_role()
returns trigger
language plpgsql
as $$
begin
  if new.role is distinct from old.role
     and current_user in ('authenticated', 'anon')
     and not public.is_admin() then
    raise exception 'No tenés permiso para cambiar el rol de una cuenta';
  end if;
  return new;
end;
$$;

create trigger profiles_protect_role
  before update on public.profiles
  for each row execute function public.protect_profile_role();

-- 4. Campos de revisión de un docente: solo administración los cambia ---------
--
-- Única excepción: un docente cuyo perfil fue rechazado puede reenviarlo a
-- revisión (rechazado -> pendiente, sin motivo), que es lo que hace la app al
-- guardar un perfil corregido.

create function public.protect_tutor_review_fields()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('authenticated', 'anon') and not public.is_admin() then
    if new.verification_status is distinct from old.verification_status
       or new.verification_reason is distinct from old.verification_reason then
      if not (
        old.verification_status = 'rechazado'
        and new.verification_status = 'pendiente'
        and new.verification_reason is null
      ) then
        raise exception 'No tenés permiso para cambiar el estado de verificación';
      end if;
    end if;

    if new.rating_promedio is distinct from old.rating_promedio
       or new.mercadopago_account_id is distinct from old.mercadopago_account_id then
      raise exception 'No tenés permiso para cambiar este dato';
    end if;
  end if;
  return new;
end;
$$;

create trigger tutor_profiles_protect_review_fields
  before update on public.tutor_profiles
  for each row execute function public.protect_tutor_review_fields();

-- 5. rating_promedio se calcula a partir de las calificaciones ----------------
--
-- Corre con los permisos de quien creó la función (security definer), por eso
-- puede escribir una columna que la guarda anterior le niega a la API.

create function public.refresh_tutor_rating()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tutor uuid;
begin
  if tg_op = 'DELETE' then
    v_tutor := old.tutor_id;
  else
    v_tutor := new.tutor_id;
  end if;

  update public.tutor_profiles
  set rating_promedio = coalesce(
    (select round(avg(score)::numeric, 2) from public.ratings where tutor_id = v_tutor),
    0
  )
  where id = v_tutor;

  return null;
end;
$$;

create trigger ratings_refresh_tutor_rating
  after insert or update or delete on public.ratings
  for each row execute function public.refresh_tutor_rating();
