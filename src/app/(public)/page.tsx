import { Home } from "@/components/home";
import { createClient } from "@/lib/supabase/server";
import { getFeaturedTutors } from "@/lib/tutors/catalog";
import { teacherFromCatalogRow } from "@/lib/tutors/view";

export default async function HomePage() {
  const supabase = await createClient();
  const { data } = await getFeaturedTutors(supabase);

  return <Home featured={(data ?? []).map(teacherFromCatalogRow)} />;
}
