-- 0022 — Contenido editable del sitio (Fase 3, ítem 2: editor de banners).
--
-- Decisión del 26 de octubre de 2026 (opciones «a + b»): desde la administración se cambian
--   a) el texto del hero de la Home: el título (hasta 3 renglones), la frase subrayada del final y el texto de
--      apoyo. La pizarra, la mascota y el diseño NO se tocan: son una decisión central de la marca;
--   b) una franja de anuncio arriba del hero, con texto, un enlace opcional y una fecha de fin opcional.
--
-- Una sola fila (`site_content`). Un campo del hero en `null` usa el texto original, que vive en el código. El
-- contenido es público: lo lee cualquiera (también sin sesión), porque es lo que se muestra en la Home. Lo cambia
-- solo la administración y cada cambio queda en el registro de acciones (0019).
--
-- Requiere 0001 a 0021.

create table public.site_content (
  id boolean primary key default true check (id),
  -- Hero (null: el texto original).
  hero_title text check (hero_title is null or (char_length(hero_title) between 1 and 90
    and array_length(string_to_array(hero_title, E'\n'), 1) <= 3)),
  hero_highlight text check (hero_highlight is null or char_length(hero_highlight) between 1 and 30),
  hero_description text check (hero_description is null or char_length(hero_description) between 1 and 160),
  -- Franja de anuncio.
  announcement_enabled boolean not null default false,
  announcement_text text check (announcement_text is null or char_length(announcement_text) between 1 and 140),
  announcement_link_label text check (announcement_link_label is null or char_length(announcement_link_label) between 1 and 40),
  -- Una ruta del sitio («/docentes») o una dirección https. Nada de javascript: ni otros esquemas.
  announcement_link_url text check (announcement_link_url is null or (char_length(announcement_link_url) <= 300
    and (announcement_link_url ~ '^/[^/\\]' or announcement_link_url = '/' or announcement_link_url ~ '^https://[^\s/]+'))),
  announcement_ends_at timestamptz,
  updated_at timestamptz not null default now(),
  -- Encendida, la franja tiene texto; un enlace lleva su texto y su dirección juntos.
  constraint site_content_announcement_text check (not announcement_enabled or announcement_text is not null),
  constraint site_content_announcement_link check ((announcement_link_label is null) = (announcement_link_url is null))
);

insert into public.site_content (id) values (true);

create trigger site_content_set_updated_at
  before update on public.site_content
  for each row execute function public.set_updated_at();

alter table public.site_content enable row level security;
revoke all on public.site_content from anon, authenticated;
grant select on public.site_content to anon, authenticated;
grant update on public.site_content to authenticated;

create policy "site_content_select_all" on public.site_content for select using (true);
create policy "site_content_update_admin" on public.site_content for update
  using (public.is_admin()) with check (public.is_admin());

-- Cada cambio queda en el registro.

alter table public.audit_log drop constraint audit_log_target_type_check;
alter table public.audit_log
  add constraint audit_log_target_type_check
  check (target_type in ('docente', 'reserva', 'cuenta', 'comision', 'contenido'));

create function public.audit_site_content_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor record;
  v_changed text[];
begin
  select array_agg(n.key order by n.key) into v_changed
  from jsonb_each(to_jsonb(new) - 'updated_at') n
  where n.value is distinct from (to_jsonb(old) -> n.key);

  if v_changed is null then
    return null;
  end if;

  select * into v_actor from public.audit_actor();

  insert into public.audit_log (actor_kind, actor_id, actor_name, action, target_type, target_id, details)
  values (
    v_actor.kind, v_actor.id, v_actor.name,
    case when v_changed <@ array['announcement_enabled', 'announcement_text', 'announcement_link_label',
                                 'announcement_link_url', 'announcement_ends_at']
         then 'cambiar_anuncio'
         when v_changed <@ array['hero_title', 'hero_highlight', 'hero_description'] then 'cambiar_hero'
         else 'cambiar_contenido' end,
    'contenido',
    '00000000-0000-0000-0000-000000000000'::uuid,
    jsonb_build_object(
      'changed', to_jsonb(v_changed),
      'before', to_jsonb(old) - 'updated_at' - 'id',
      'after', to_jsonb(new) - 'updated_at' - 'id'));

  return null;
end;
$$;

revoke all on function public.audit_site_content_change() from public, anon, authenticated;

create trigger site_content_audit
  after update on public.site_content
  for each row execute function public.audit_site_content_change();
