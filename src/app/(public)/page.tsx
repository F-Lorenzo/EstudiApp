import { Home } from "@/components/home";
import { announcementFrom, getSiteContentRow, heroFrom } from "@/lib/content/site-content";
import { createClient } from "@/lib/supabase/server";
import { getFeaturedTutors } from "@/lib/tutors/catalog";
import { teacherFromCatalogRow } from "@/lib/tutors/view";

export default async function HomePage() {
  const supabase = await createClient();
  const [{ data }, content] = await Promise.all([getFeaturedTutors(supabase), getSiteContentRow(supabase)]);

  return (
    <Home
      featured={(data ?? []).map(teacherFromCatalogRow)}
      hero={heroFrom(content)}
      announcement={announcementFrom(content)}
    />
  );
}
