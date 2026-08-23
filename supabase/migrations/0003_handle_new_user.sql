-- EstudiApp — Alta automática de perfil al registrarse (sección 2)
-- Crea la fila en public.profiles (y en public.tutor_profiles si el rol es
-- docente) apenas se crea el usuario en auth.users, sin depender de que el
-- cliente tenga sesión activa (funciona incluso con confirmación de email
-- pendiente).

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role;
begin
  -- raw_user_meta_data lo define el cliente en el signup: nunca confiar en
  -- él para el rol "administrador" (solo asignable manualmente en la base).
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
  end if;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
