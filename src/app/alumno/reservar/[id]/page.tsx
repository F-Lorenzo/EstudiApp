import { notFound } from "next/navigation";
import { Reservation } from "@/components/student-booking";
import { readBookingChoice, type BookingSearchParams } from "@/lib/bookings/params";
import { todayAR } from "@/lib/format";
import { getPublicTeacher } from "@/lib/tutors/public";

export const metadata = { title: "Elegí tu horario" };

export default async function ReservarPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<BookingSearchParams>;
}) {
  const { id } = await params;
  const teacher = await getPublicTeacher(id);
  if (!teacher) notFound();

  return (
    <Reservation
      teacher={teacher}
      today={todayAR()}
      initial={readBookingChoice(await searchParams)}
    />
  );
}
