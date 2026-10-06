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

create unique index availability_slots_tutor_start_key
  on public.availability_slots (tutor_id, starts_at);
