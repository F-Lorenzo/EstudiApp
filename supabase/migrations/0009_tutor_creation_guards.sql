-- EstudiApp — Cierra dos huecos de la RLS que el sistema de reservas vuelve
-- delicados porque ahora hay dinero de por medio.
--
-- Todavía NO se aplicó a ningún proyecto de Supabase. Requiere 0001 a 0006.
--
-- 1. Cualquier cuenta podía crearse un perfil de docente ya «aprobado».
--
--    La migración 0006 impide que un docente cambie su estado de verificación
--    editando su fila (trigger BEFORE UPDATE), pero nada miraba el INSERT: la
--    política de 0002 solo pedía `id = auth.uid()`. Un alumno cualquiera podía
--    insertar su propia fila en `tutor_profiles` con estado «aprobado», su
--    propia cuenta de Mercado Pago y calificación 5; aparecía en el catálogo y
--    podía cobrar reservas sin que la administración lo revisara.
--
--    Ahora la fila solo se puede crear si la cuenta es de docente, y siempre
--    empieza «pendiente», sin calificación ni cuenta de cobro. (El alta normal
--    la hace el trigger `handle_new_user` al registrarse, que corre con los
--    permisos del dueño y no pasa por estas guardas.)

-- Helper con security definer (igual que is_admin): si la política consultara
-- `profiles` directamente, la RLS de `profiles` vuelve a consultar
-- `tutor_profiles` y Postgres corta con «infinite recursion in policy».
create function public.is_docente()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'docente'
  );
$$;

drop policy "tutor_profiles_insert_own" on public.tutor_profiles;

create policy "tutor_profiles_insert_own_docente"
  on public.tutor_profiles for insert
  with check (id = auth.uid() and public.is_docente());

create function public.protect_tutor_insert()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('authenticated', 'anon') and not public.is_admin() then
    if new.verification_status is distinct from 'pendiente'
       or new.verification_reason is not null
       or new.rating_promedio is distinct from 0
       or new.mercadopago_account_id is not null then
      raise exception 'No tenés permiso para crear el perfil con esos datos';
    end if;
  end if;
  return new;
end;
$$;

create trigger tutor_profiles_protect_insert
  before insert on public.tutor_profiles
  for each row execute function public.protect_tutor_insert();

-- 2. Un alumno con cualquier clase completada podía calificar a cualquier docente.
--
--    La política de `ratings` pedía que la reserva fuera del alumno y estuviera
--    completada, pero no que `ratings.tutor_id` fuera el docente de esa reserva.
--    Con una clase completada con un docente, se podía puntuar con 1 a otro y
--    bajarle el `rating_promedio`.

drop policy "ratings_insert_own_student_for_completed_booking" on public.ratings;

create policy "ratings_insert_own_student_for_completed_booking"
  on public.ratings for insert
  with check (
    student_id = auth.uid()
    and exists (
      select 1 from public.bookings b
      where b.id = ratings.booking_id
        and b.student_id = auth.uid()
        and b.tutor_id = ratings.tutor_id
        and b.status = 'completada'
    )
  );
