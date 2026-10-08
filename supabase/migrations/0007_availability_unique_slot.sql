-- EstudiApp — Un docente no puede tener dos franjas que empiecen a la misma hora.
--
-- La pantalla «Mi disponibilidad» abre y cierra franjas de 60 minutos que
-- empiezan en punto. Esta restricción evita duplicados aunque dos pedidos
-- lleguen a la vez.
--
-- Antes de aplicarla, comprobá que no haya duplicados (si los hay, la creación
-- del índice falla y hay que dejar una sola fila por docente y hora):
--
--   select tutor_id, starts_at, count(*)
--   from public.availability_slots
--   group by tutor_id, starts_at
--   having count(*) > 1;

-- Si hay duplicados, se corta acá con un mensaje claro en lugar de un error de índice.
do $$
begin
  if exists (
    select 1
    from public.availability_slots
    group by tutor_id, starts_at
    having count(*) > 1
  ) then
    raise exception
      'Hay franjas duplicadas (mismo docente y misma hora). Dejá una sola por docente y hora y volvé a aplicar esta migración. La consulta para encontrarlas está en el encabezado de 0007_availability_unique_slot.sql.';
  end if;
end;
$$;

create unique index availability_slots_tutor_start_key
  on public.availability_slots (tutor_id, starts_at);
