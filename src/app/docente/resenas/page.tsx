import { redirect } from "next/navigation";
import { TeacherReviews } from "@/components/teacher-reviews";
import { getViewer } from "@/lib/auth/viewer";
import { getMyLevel, getMyReviews } from "@/lib/ratings/appeals";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Mis reseñas" };

export default async function MisResenasPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");

  const supabase = await createClient();
  const [level, { reviews, error }] = await Promise.all([getMyLevel(supabase), getMyReviews(supabase)]);

  return <TeacherReviews level={level} reviews={reviews} loadFailed={error} />;
}
