import { AdminAppeals } from "@/components/admin-appeals";
import { getAdminAppeals } from "@/lib/ratings/appeals";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Reseñas apeladas" };

export default async function ResenasApeladasPage() {
  const supabase = await createClient();
  const { appeals, error } = await getAdminAppeals(supabase);
  return <AdminAppeals appeals={appeals} loadFailed={error} />;
}
