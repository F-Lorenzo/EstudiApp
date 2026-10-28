-- 0026 — Fotos de perfil y respaldos de los docentes en Supabase Storage (decisión del 28 de octubre de 2026).
--
-- Hasta ahora la foto y el respaldo eran enlaces que la persona pegaba. Desde esta migración se suben desde el
-- dispositivo:
--
--   · avatars       carpeta PÚBLICA (la foto se ve en el catálogo y en el perfil). Cada cuenta escribe solo en su
--                   propia subcarpeta (`<id de la cuenta>/archivo`). Solo imágenes JPG, PNG o WebP, hasta 2 MB
--                   (la app las achica a 400 × 400 antes de subirlas).
--   · credentials   carpeta PRIVADA con el respaldo de la trayectoria (título, CV). Sube solo un docente, en su
--                   propia subcarpeta; lo leen solo él y la administración, con enlaces firmados que vencen. PDF o
--                   imagen, hasta 5 MB.
--
-- Los límites de tamaño y de tipo los aplica Supabase Storage al recibir el archivo; quién puede hacer qué lo
-- deciden las políticas de abajo, sobre `storage.objects` (que ya tiene la RLS encendida).
--
-- Requiere 0001 a 0025.

-- 1. Las carpetas -----------------------------------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp']),
  ('credentials', 'credentials', false, 5242880, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2. Fotos de perfil ---------------------------------------------------------------------------------------------------
--
-- La subcarpeta tiene que ser exactamente la de la cuenta, y un solo nivel: `<id>/foto.webp`, no `<id>/x/foto.webp`
-- ni `otro-id/foto.webp`. Leer las propias sirve para listar y borrar las viejas; la foto pública se sirve por su
-- dirección pública, sin pasar por estas políticas.

create policy "estudiapp_avatars_select_own"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
    and array_length(storage.foldername(name), 1) = 1
  );

create policy "estudiapp_avatars_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
    and array_length(storage.foldername(name), 1) = 1
  );

create policy "estudiapp_avatars_update_own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
    and array_length(storage.foldername(name), 1) = 1
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
    and array_length(storage.foldername(name), 1) = 1
  );

create policy "estudiapp_avatars_delete_own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
    and array_length(storage.foldername(name), 1) = 1
  );

-- 3. Respaldos de los docentes -----------------------------------------------------------------------------------------
--
-- Sube solo una cuenta de docente, en su subcarpeta. Lo lee el dueño y la administración (para revisar el perfil);
-- nadie más, ni siquiera con el enlace: la carpeta es privada y la app da enlaces firmados de pocos minutos.

create policy "estudiapp_credentials_select_own_or_admin"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'credentials'
    and (
      ((storage.foldername(name))[1] = auth.uid()::text and array_length(storage.foldername(name), 1) = 1)
      or public.is_admin()
    )
  );

create policy "estudiapp_credentials_insert_own_tutor"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'credentials'
    and (storage.foldername(name))[1] = auth.uid()::text
    and array_length(storage.foldername(name), 1) = 1
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'docente')
  );

create policy "estudiapp_credentials_update_own_tutor"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'credentials'
    and (storage.foldername(name))[1] = auth.uid()::text
    and array_length(storage.foldername(name), 1) = 1
  )
  with check (
    bucket_id = 'credentials'
    and (storage.foldername(name))[1] = auth.uid()::text
    and array_length(storage.foldername(name), 1) = 1
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'docente')
  );

create policy "estudiapp_credentials_delete_own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'credentials'
    and (storage.foldername(name))[1] = auth.uid()::text
    and array_length(storage.foldername(name), 1) = 1
  );
