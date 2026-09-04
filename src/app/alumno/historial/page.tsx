import { BookingList } from "@/components/booking-list";
import { getCompletedBookings } from "@/lib/mock/queries";
import { getMockSession } from "@/lib/mock/session";

export default async function HistorialPage() {
  const profile = await getMockSession();
  const bookings = profile ? getCompletedBookings(profile.id) : [];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Historial de clases</h1>
      <BookingList bookings={bookings} emptyMessage="Todavía no tomaste ninguna clase." />
    </div>
  );
}
