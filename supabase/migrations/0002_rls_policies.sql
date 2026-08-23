-- EstudiApp — Políticas RLS base (MVP)
-- Restringe el acceso a datos según el usuario autenticado (sección 16).

alter table public.profiles enable row level security;
alter table public.tutor_profiles enable row level security;
alter table public.subjects enable row level security;
alter table public.tutor_subjects enable row level security;
alter table public.availability_slots enable row level security;
alter table public.bookings enable row level security;
alter table public.payments enable row level security;
alter table public.payment_webhook_events enable row level security;
alter table public.video_rooms enable row level security;
alter table public.ratings enable row level security;

-- Helper: usuario autenticado actual tiene rol administrador
create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'administrador'
  );
$$;

-- profiles ------------------------------------------------------------------

create policy "profiles_select_own_or_admin"
  on public.profiles for select
  using (id = auth.uid() or public.is_admin());

create policy "profiles_select_public_tutor"
  on public.profiles for select
  using (
    exists (
      select 1 from public.tutor_profiles tp
      where tp.id = profiles.id and tp.verification_status = 'aprobado'
    )
  );

create policy "profiles_insert_own"
  on public.profiles for insert
  with check (id = auth.uid());

create policy "profiles_update_own_or_admin"
  on public.profiles for update
  using (id = auth.uid() or public.is_admin());

-- tutor_profiles --------------------------------------------------------

create policy "tutor_profiles_select_public_when_approved"
  on public.tutor_profiles for select
  using (verification_status = 'aprobado');

create policy "tutor_profiles_select_own_or_admin"
  on public.tutor_profiles for select
  using (id = auth.uid() or public.is_admin());

create policy "tutor_profiles_insert_own"
  on public.tutor_profiles for insert
  with check (id = auth.uid());

create policy "tutor_profiles_update_own"
  on public.tutor_profiles for update
  using (id = auth.uid());

create policy "tutor_profiles_update_admin"
  on public.tutor_profiles for update
  using (public.is_admin());

-- subjects (catálogo público) ------------------------------------------

create policy "subjects_select_all"
  on public.subjects for select
  using (true);

create policy "subjects_write_admin"
  on public.subjects for insert
  with check (public.is_admin());

create policy "subjects_update_admin"
  on public.subjects for update
  using (public.is_admin());

create policy "subjects_delete_admin"
  on public.subjects for delete
  using (public.is_admin());

-- tutor_subjects ----------------------------------------------------------

create policy "tutor_subjects_select_public_when_approved"
  on public.tutor_subjects for select
  using (
    exists (
      select 1 from public.tutor_profiles tp
      where tp.id = tutor_subjects.tutor_id and tp.verification_status = 'aprobado'
    )
  );

create policy "tutor_subjects_manage_own"
  on public.tutor_subjects for all
  using (tutor_id = auth.uid())
  with check (tutor_id = auth.uid());

-- availability_slots --------------------------------------------------

create policy "availability_slots_select_public_available"
  on public.availability_slots for select
  using (
    is_booked = false
    and exists (
      select 1 from public.tutor_profiles tp
      where tp.id = availability_slots.tutor_id and tp.verification_status = 'aprobado'
    )
  );

create policy "availability_slots_select_own_tutor"
  on public.availability_slots for select
  using (tutor_id = auth.uid() or public.is_admin());

create policy "availability_slots_manage_own_tutor"
  on public.availability_slots for insert
  with check (tutor_id = auth.uid());

create policy "availability_slots_update_own_unbooked"
  on public.availability_slots for update
  using (tutor_id = auth.uid() and is_booked = false);

create policy "availability_slots_delete_own_unbooked"
  on public.availability_slots for delete
  using (tutor_id = auth.uid() and is_booked = false);

-- bookings ------------------------------------------------------------------

create policy "bookings_select_participant_or_admin"
  on public.bookings for select
  using (student_id = auth.uid() or tutor_id = auth.uid() or public.is_admin());

create policy "bookings_insert_own_student"
  on public.bookings for insert
  with check (student_id = auth.uid());

create policy "bookings_update_participant_or_admin"
  on public.bookings for update
  using (student_id = auth.uid() or tutor_id = auth.uid() or public.is_admin());

-- payments (solo lectura para participantes; escritura vía service role / webhooks) --

create policy "payments_select_participant_or_admin"
  on public.payments for select
  using (
    public.is_admin()
    or exists (
      select 1 from public.bookings b
      where b.id = payments.booking_id
        and (b.student_id = auth.uid() or b.tutor_id = auth.uid())
    )
  );

-- payment_webhook_events: sin políticas para authenticated/anon;
-- solo accesible con la service role key desde el backend de webhooks.

-- video_rooms ---------------------------------------------------------------

create policy "video_rooms_select_participant"
  on public.video_rooms for select
  using (
    exists (
      select 1 from public.bookings b
      where b.id = video_rooms.booking_id
        and (b.student_id = auth.uid() or b.tutor_id = auth.uid())
    )
  );

-- ratings ---------------------------------------------------------------

create policy "ratings_select_public_when_tutor_approved"
  on public.ratings for select
  using (
    exists (
      select 1 from public.tutor_profiles tp
      where tp.id = ratings.tutor_id and tp.verification_status = 'aprobado'
    )
  );

create policy "ratings_insert_own_student_for_completed_booking"
  on public.ratings for insert
  with check (
    student_id = auth.uid()
    and exists (
      select 1 from public.bookings b
      where b.id = ratings.booking_id
        and b.student_id = auth.uid()
        and b.status = 'completada'
    )
  );
