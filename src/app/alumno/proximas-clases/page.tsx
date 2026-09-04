import { BookingList } from "@/components/booking-list";
import { getUpcomingBookings } from "@/lib/mock/queries";
import { getMockSession } from "@/lib/mock/session";

export default async function ProximasClasesPage() {
  const profile = await getMockSession();
  const bookings = profile ? getUpcomingBookings(profile.id) : [];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Próximas clases</h1>
      <BookingList bookings={bookings} emptyMessage="Todavía no tenés clases reservadas." />
    </div>
  );
}
