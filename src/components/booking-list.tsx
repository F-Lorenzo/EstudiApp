import type { StudentBookingRow } from "@/lib/bookings/queries";

const dateFormatter = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function BookingList({
  bookings,
  emptyMessage,
}: {
  bookings: StudentBookingRow[];
  emptyMessage: string;
}) {
  if (bookings.length === 0) {
    return <p className="text-sm text-neutral-600">{emptyMessage}</p>;
  }

  return (
    <ul className="divide-y rounded border">
      {bookings.map((booking) => (
        <li key={booking.id} className="flex items-center justify-between p-4">
          <div>
            <p className="font-medium">
              {booking.tutor_profiles?.profiles?.full_name ?? "Docente"}
            </p>
            {booking.availability_slots && (
              <p className="text-sm text-neutral-600">
                {dateFormatter.format(new Date(booking.availability_slots.starts_at))}
              </p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
