import { BookingList } from "@/components/booking-list";
import { getCompletedBookings } from "@/lib/bookings/queries";
import { createClient } from "@/lib/supabase/server";

export default async function HistorialPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: bookings } = await getCompletedBookings(supabase, user!.id);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Historial de clases</h1>
      <BookingList
        bookings={bookings ?? []}
        emptyMessage="Todavía no tomaste ninguna clase."
      />
    </div>
  );
}
