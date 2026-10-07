import { notFound } from "next/navigation";
import { BookingSlotPicker } from "@/components/booking-slot-picker";
import { getBookableSlots } from "@/lib/bookings/queries";
import { createClient } from "@/lib/supabase/server";
import { getPublicTeacher } from "@/lib/tutors/public";

export const metadata = { title: "Elegí tu horario" };

export default async function ReservarPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ slot?: string | string[] }>;
}) {
  const { id } = await params;
  const teacher = await getPublicTeacher(id);
  if (!teacher) notFound();

  const slot = (await searchParams).slot;
  const supabase = await createClient();
  const slots = await getBookableSlots(supabase, id);

  return (
    <BookingSlotPicker
      teacher={teacher}
      slots={slots}
      initialSlotId={Array.isArray(slot) ? slot[0] : slot}
    />
  );
}
