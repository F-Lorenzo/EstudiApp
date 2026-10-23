import { RoomPage } from "@/lib/video/room-page";

export const metadata = { title: "Tu clase" };

export default async function SalaDocentePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RoomPage bookingId={id} role="docente" />;
}
