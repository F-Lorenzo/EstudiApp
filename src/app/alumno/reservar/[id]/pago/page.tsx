import { notFound, redirect } from "next/navigation";
import { Checkout } from "@/components/student-booking";
import { readBookingChoice, type BookingSearchParams } from "@/lib/bookings/params";
import { getPublicTeacher } from "@/lib/tutors/public";

export const metadata = { title: "Confirmá tu clase" };

export default async function PagoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<BookingSearchParams>;
}) {
  const { id } = await params;
  const teacher = await getPublicTeacher(id);
  if (!teacher) notFound();

  const choice = readBookingChoice(await searchParams);
  // Sin día y horario no hay nada que confirmar: se vuelve a elegirlos.
  if (!choice.date || !choice.time) redirect(`/alumno/reservar/${id}`);

  return (
    <Checkout
      teacher={teacher}
      details={{
        date: choice.date,
        time: choice.time,
        subject: choice.subject || teacher.subject,
      }}
    />
  );
}
