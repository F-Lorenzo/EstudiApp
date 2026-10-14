import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { BookingDetailView } from "@/components/booking-detail";
import { getViewer } from "@/lib/auth/viewer";
import { holdExpiresAt } from "@/lib/bookings/hold";
import { parsePaymentReturn } from "@/lib/bookings/payment-ui";
import { getStudentBooking } from "@/lib/bookings/queries";
import { paymentSimulationEnabled } from "@/lib/bookings/simulation";
import { paymentsConfigured } from "@/lib/payments/config";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Tu reserva" };

export default async function ReservaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  /** `?pago=ok|pendiente|fallido`: cómo volvió el alumno de Mercado Pago. Solo decide qué mensaje se muestra. */
  searchParams: Promise<{ pago?: string | string[] }>;
}) {
  const { id } = await params;
  // Un id que no es un UUID haría fallar la consulta: se trata como inexistente.
  if (!z.uuid().safeParse(id).success) notFound();

  const viewer = await getViewer();
  if (!viewer) redirect("/login");

  const supabase = await createClient();
  const booking = await getStudentBooking(supabase, id, viewer.id);
  if (!booking) notFound();

  const { pago } = await searchParams;

  return (
    <BookingDetailView
      booking={booking}
      expiresAt={holdExpiresAt(booking.createdAt).toISOString()}
      now={new Date().getTime()}
      simulationEnabled={paymentSimulationEnabled()}
      paymentsEnabled={paymentsConfigured()}
      // El parámetro nunca confirma nada: el estado real de la reserva sale de la base.
      paymentReturn={parsePaymentReturn(pago)}
    />
  );
}
