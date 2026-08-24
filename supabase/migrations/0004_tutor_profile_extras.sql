-- EstudiApp — Perfil de docente: campo de respaldo/adjunto y catálogo
-- inicial de materias (sección 4). El listado exacto de materias es
-- editable desde la tabla; esto es solo una semilla para no arrancar
-- con el selector vacío.

alter table public.tutor_profiles
  add column credential_url text;

insert into public.subjects (name) values
  ('Matemática'),
  ('Física'),
  ('Química'),
  ('Biología'),
  ('Lengua y Literatura'),
  ('Inglés'),
  ('Historia'),
  ('Geografía'),
  ('Programación'),
  ('Contabilidad')
on conflict (name) do nothing;
