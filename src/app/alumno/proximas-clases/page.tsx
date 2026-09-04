import { BookingList } from "@/components/booking-list";
import { getUpcomingBookings } from "@/lib/bookings/queries";
import { createClient } from "@/lib/supabase/server";

export default async function ProximasClasesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: bookings } = await getUpcomingBookings(supabase, user!.id);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Próximas clases</h1>
      <BookingList
        bookings={bookings ?? []}
        emptyMessage="Todavía no tenés clases reservadas."
      />
    </div>
  );
}
