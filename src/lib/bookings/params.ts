/** Fecha y hora elegidas, en formato `YYYY-MM-DD` y `HH:mm` (hora de Argentina). */
export type BookingChoice = { date: string; time: string; subject: string };

export type BookingSearchParams = {
  fecha?: string;
  hora?: string;
  materia?: string;
};

/** Lee y valida la fecha, hora y materia que viajan por la URL durante la reserva. */
export function readBookingChoice(
  params: BookingSearchParams,
): Partial<BookingChoice> {
  const choice: Partial<BookingChoice> = {};
  if (
    params.fecha &&
    /^\d{4}-\d{2}-\d{2}$/.test(params.fecha) &&
    !Number.isNaN(new Date(`${params.fecha}T12:00:00`).getTime())
  ) {
    choice.date = params.fecha;
  }
  if (params.hora && /^([01]\d|2[0-3]):[0-5]\d$/.test(params.hora)) {
    choice.time = params.hora;
  }
  if (params.materia) choice.subject = params.materia.slice(0, 80);
  return choice;
}
