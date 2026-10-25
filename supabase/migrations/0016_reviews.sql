-- 0016 — Calificación después de la clase y opiniones con autor (Fase 2, ítem 5).
--
--  1. Las opiniones públicas muestran quién las escribió: nombre y la inicial del apellido («Tomás R.»),
--     nunca el nombre completo, la foto ni el id del alumno. Hasta ahora `ratings` era legible por cualquiera
--     (para un docente aprobado) con todas sus columnas, incluido `student_id`. Ahora la tabla la leen solo
--     las dos partes de la clase y la administración, y la vista pública sale de `tutor_reviews`, que
--     devuelve únicamente lo que se muestra.
--  2. Se califica una clase completada propia, una sola vez (ya lo garantiza `booking_id unique`) y dentro de
--     los 30 días posteriores al final de la clase.
--  3. La fecha de la opinión la pone la base (no la puede elegir quien califica) y el comentario se limpia:
--     sin espacios sobrantes, vacío pasa a `null`, como mucho 600 caracteres.
--
-- No hay editar ni borrar desde la API (no existen esas políticas): una calificación enviada queda.

-- 1. Quién lee la tabla -------------------------------------------------------------------------------------

drop policy "ratings_select_public_when_tutor_approved" on public.ratings;

create policy "ratings_select_parties_or_admin"
  on public.ratings for select
  using (student_id = auth.uid() or tutor_id = auth.uid() or public.is_admin());

-- 2. Quién califica y hasta cuándo -------------------------------------------------------------------------

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
        and b.ends_at > now() - interval '30 days'
    )
  );

-- 3. Fecha y comentario -------------------------------------------------------------------------------------

-- `not valid`: lo nuevo se comprueba; lo que ya estaba no se revisa (no hay comentarios largos, pero aplicar la
-- migración no depende de eso).
alter table public.ratings
  add constraint ratings_comment_length check (char_length(comment) <= 600) not valid;

create function public.normalize_rating()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.comment := nullif(btrim(new.comment), '');
  -- Quien califica desde la app no elige la fecha. El backend (sin sesión de usuario) puede cargar datos con
  -- su fecha original.
  if auth.uid() is not null then
    new.created_at := now();
  end if;
  return new;
end;
$$;

revoke all on function public.normalize_rating() from public, anon, authenticated;

create trigger ratings_normalize
  before insert on public.ratings
  for each row execute function public.normalize_rating();

-- 4. Opiniones públicas de un docente ---------------------------------------------------------------------
--
-- Solo de docentes aprobados, de la más reciente a la más antigua. `review_count` es el total (aunque se
-- pidan menos filas). El autor es el nombre y la inicial del apellido; sin nombre cargado, «Estudiante».

create function public.tutor_reviews(p_tutor_id uuid, p_limit integer default 50)
returns table (score smallint, comment text, created_at timestamptz, author_name text, review_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.score,
    r.comment,
    r.created_at,
    case
      when coalesce(n.first, '') = '' then 'Estudiante'
      when coalesce(n.second, '') = '' then n.first
      else n.first || ' ' || upper(left(n.second, 1)) || '.'
    end,
    count(*) over ()
  from public.ratings r
  join public.tutor_profiles tp on tp.id = r.tutor_id and tp.verification_status = 'aprobado'
  left join public.profiles p on p.id = r.student_id
  cross join lateral (
    select
      split_part(regexp_replace(btrim(coalesce(p.full_name, '')), '\s+', ' ', 'g'), ' ', 1) as first,
      split_part(regexp_replace(btrim(coalesce(p.full_name, '')), '\s+', ' ', 'g'), ' ', 2) as second
  ) n
  where r.tutor_id = p_tutor_id
  order by r.created_at desc, r.id
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;

revoke all on function public.tutor_reviews(uuid, integer) from public;
grant execute on function public.tutor_reviews(uuid, integer) to anon, authenticated, service_role;
