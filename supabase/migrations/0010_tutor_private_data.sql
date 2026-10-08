-- EstudiApp — Los datos privados de un docente salen de la tabla pública.
--
-- Problema: la política `tutor_profiles_select_public_when_approved` (0002) es por fila, así que
-- cualquiera con la clave pública (anon) podía leer TODAS las columnas de un docente aprobado:
-- además de lo que se muestra en su perfil, `contacto_verificacion` (teléfono o email),
-- `credential_url` (su respaldo) y `mercadopago_account_id`. Con el cobro real a la vuelta de la
-- esquina, ahí mismo iban a terminar las credenciales de Mercado Pago del docente.
--
-- Solución: esas tres columnas pasan a `public.tutor_private`, que solo lee el propio docente y
-- la administración. Lo que sigue en `tutor_profiles` es público a propósito: biografía,
-- formación, tarifa, calificación y estado de verificación.
--
-- Todavía NO se aplicó a ningún proyecto de Supabase. Requiere 0001 a 0009.
-- Los datos existentes se copian antes de borrar las columnas.

-- 1. La tabla privada ---------------------------------------------------------------------------

create table public.tutor_private (
  id uuid primary key references public.tutor_profiles (id) on delete cascade,
  -- Teléfono o email con el que la administración verifica al docente.
  contacto_verificacion text,
  -- Enlace al respaldo de su formación.
  credential_url text,
  -- Cuenta de Mercado Pago vinculada. La escribe solo el backend (service role) o la
  -- administración, nunca el propio docente desde la API.
  mercadopago_account_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger tutor_private_set_updated_at
  before update on public.tutor_private
  for each row execute function public.set_updated_at();

alter table public.tutor_private enable row level security;

-- Un visitante sin sesión no tiene nada que hacer acá: ni siquiera el permiso.
revoke all on public.tutor_private from anon;

-- 2. Copiar los datos que ya existen --------------------------------------------------------------

insert into public.tutor_private (id, contacto_verificacion, credential_url, mercadopago_account_id)
select id, contacto_verificacion, credential_url, mercadopago_account_id
from public.tutor_profiles;

-- 3. Las guardas de 0006 y 0009 dejan de mirar la cuenta de Mercado Pago --------------------------
--
-- Hay que reemplazarlas ANTES de borrar la columna: una función de plpgsql que nombra una columna
-- inexistente recién falla al ejecutarse, y rompería cada actualización de un docente.

create or replace function public.protect_tutor_review_fields()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('authenticated', 'anon') and not public.is_admin() then
    if new.verification_status is distinct from old.verification_status
       or new.verification_reason is distinct from old.verification_reason then
      -- Única excepción: un docente rechazado puede reenviar su perfil a revisión.
      if not (
        old.verification_status = 'rechazado'
        and new.verification_status = 'pendiente'
        and new.verification_reason is null
      ) then
        raise exception 'No tenés permiso para cambiar el estado de verificación';
      end if;
    end if;

    if new.rating_promedio is distinct from old.rating_promedio then
      raise exception 'No tenés permiso para cambiar este dato';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.protect_tutor_insert()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('authenticated', 'anon') and not public.is_admin() then
    if new.verification_status is distinct from 'pendiente'
       or new.verification_reason is not null
       or new.rating_promedio is distinct from 0 then
      raise exception 'No tenés permiso para crear el perfil con esos datos';
    end if;
  end if;
  return new;
end;
$$;

-- 4. Borrar las columnas de la tabla pública -----------------------------------------------------

alter table public.tutor_profiles
  drop column contacto_verificacion,
  drop column credential_url,
  drop column mercadopago_account_id;

-- 5. Quién ve y quién escribe la tabla privada ------------------------------------------------------

create policy "tutor_private_select_own_or_admin"
  on public.tutor_private for select
  using (id = auth.uid() or public.is_admin());

create policy "tutor_private_insert_own_docente"
  on public.tutor_private for insert
  with check (id = auth.uid() and public.is_docente());

create policy "tutor_private_update_own"
  on public.tutor_private for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- Sin política de DELETE: la fila se borra en cascada junto con el perfil del docente.

-- 6. El docente no puede fijar su propia cuenta de Mercado Pago ----------------------------------------
--
-- Solo la service role (el backend, cuando exista el flujo OAuth de la Fase 1) o la
-- administración. Sin esto, un docente podría apuntar los cobros a cualquier cuenta.

create function public.protect_tutor_private()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('authenticated', 'anon') and not public.is_admin() then
    if tg_op = 'INSERT' then
      if new.mercadopago_account_id is not null then
        raise exception 'No tenés permiso para cambiar este dato';
      end if;
    elsif new.mercadopago_account_id is distinct from old.mercadopago_account_id then
      raise exception 'No tenés permiso para cambiar este dato';
    end if;
  end if;
  return new;
end;
$$;

create trigger tutor_private_protect
  before insert or update on public.tutor_private
  for each row execute function public.protect_tutor_private();

-- 7. Cada docente nuevo nace con su fila privada -----------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role;
begin
  -- raw_user_meta_data lo define el cliente en el signup: nunca confiar en él para el rol
  -- "administrador" (solo asignable manualmente en la base).
  if new.raw_user_meta_data ->> 'role' = 'docente' then
    v_role := 'docente';
  else
    v_role := 'alumno';
  end if;

  insert into public.profiles (id, role, full_name)
  values (new.id, v_role, coalesce(new.raw_user_meta_data ->> 'full_name', ''));

  if v_role = 'docente' then
    insert into public.tutor_profiles (id)
    values (new.id);

    insert into public.tutor_private (id)
    values (new.id);
  end if;

  return new;
end;
$$;
