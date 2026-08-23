-- EstudiApp — Modelo de datos base (MVP)
-- Basado en la Especificación Funcional — MVP (secciones 1-11)

create extension if not exists "pgcrypto";

-- 1. Roles de usuario ---------------------------------------------------

create type user_role as enum ('alumno', 'docente', 'administrador');

-- Perfil base para todo usuario autenticado (1:1 con auth.users)
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role user_role not null default 'alumno',
  full_name text not null default '',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 4. Perfil de docente ---------------------------------------------------

create type tutor_verification_status as enum ('pendiente', 'aprobado', 'rechazado');

create table public.tutor_profiles (
  id uuid primary key references public.profiles (id) on delete cascade,
  bio text not null default '',
  nivel_academico text,
  tarifa_por_clase numeric(10, 2) not null default 0,
  contacto_verificacion text,
  verification_status tutor_verification_status not null default 'pendiente',
  verification_reason text,
  rating_promedio numeric(3, 2) not null default 0,
  mercadopago_account_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  name text not null unique
);

create table public.tutor_subjects (
  tutor_id uuid not null references public.tutor_profiles (id) on delete cascade,
  subject_id uuid not null references public.subjects (id) on delete cascade,
  primary key (tutor_id, subject_id)
);

-- 7. Agenda y disponibilidad ---------------------------------------------

create table public.availability_slots (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references public.tutor_profiles (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  is_booked boolean not null default false,
  created_at timestamptz not null default now(),
  constraint availability_slots_valid_range check (ends_at > starts_at)
);

create index availability_slots_tutor_idx on public.availability_slots (tutor_id, starts_at);

-- 8. Reservas (bookings) --------------------------------------------------

create type booking_status as enum (
  'pendiente_pago',
  'confirmada',
  'completada',
  'cancelada'
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  tutor_id uuid not null references public.tutor_profiles (id) on delete cascade,
  slot_id uuid not null unique references public.availability_slots (id) on delete cascade,
  status booking_status not null default 'pendiente_pago',
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index bookings_student_idx on public.bookings (student_id);
create index bookings_tutor_idx on public.bookings (tutor_id);

-- 9. Pagos ------------------------------------------------------------------

create type payment_status as enum ('pendiente', 'aprobado', 'rechazado', 'reembolsado');

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings (id) on delete cascade,
  mercadopago_payment_id text unique,
  status payment_status not null default 'pendiente',
  amount numeric(10, 2) not null,
  commission_amount numeric(10, 2) not null default 0,
  tutor_amount numeric(10, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Registro idempotente de eventos de webhook de Mercado Pago
create table public.payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  mercadopago_event_id text not null unique,
  payment_id uuid references public.payments (id) on delete set null,
  payload jsonb not null,
  received_at timestamptz not null default now()
);

-- 10. Videollamada ------------------------------------------------------

create table public.video_rooms (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings (id) on delete cascade,
  room_url text not null,
  created_at timestamptz not null default now()
);

-- 11. Calificaciones y reputación ----------------------------------------

create table public.ratings (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  tutor_id uuid not null references public.tutor_profiles (id) on delete cascade,
  score smallint not null check (score between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);

create index ratings_tutor_idx on public.ratings (tutor_id);

-- updated_at helper trigger ------------------------------------------------

create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger tutor_profiles_set_updated_at
  before update on public.tutor_profiles
  for each row execute function public.set_updated_at();

create trigger bookings_set_updated_at
  before update on public.bookings
  for each row execute function public.set_updated_at();

create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();
