"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";
import { siteContentSchema } from "@/lib/validation/site-content";
import { echoValues, type ActionState } from "@/lib/validation/form-state";

const FIELDS = [
  "heroTitle",
  "heroHighlight",
  "heroDescription",
  "announcementText",
  "announcementLinkLabel",
  "announcementLinkUrl",
  "announcementEndsAt",
];

/**
 * Guarda el texto del hero y la franja de anuncio de la Home. Se verifica el rol acá también; la barrera real es
 * la RLS de la migración 0022 (solo administración) y cada cambio queda en el registro por un trigger.
 */
export async function saveSiteContent(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const viewer = await getViewer();
  if (viewer?.role !== "administrador") return { error: "No tenés permiso para cambiar el contenido del sitio." };

  const raw = Object.fromEntries(FIELDS.map((key) => [key, String(formData.get(key) ?? "")]));
  const parsed = siteContentSchema.safeParse({ ...raw, announcementEnabled: formData.get("announcementEnabled") ?? undefined });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors, values: echoValues(formData, FIELDS) };
  }

  const c = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("site_content")
    .update({
      hero_title: c.heroTitle,
      hero_highlight: c.heroHighlight,
      hero_description: c.heroDescription,
      announcement_enabled: c.announcementEnabled,
      announcement_text: c.announcementText,
      announcement_link_label: c.announcementLinkLabel,
      announcement_link_url: c.announcementLinkUrl,
      announcement_ends_at: c.announcementEndsAt,
    })
    .eq("id", true)
    .select("id");
  if (error || !data?.length) {
    return { error: "No se pudo publicar el contenido. Intentá de nuevo.", values: echoValues(formData, FIELDS) };
  }

  revalidatePath("/");
  revalidatePath("/admin/contenido");
  revalidatePath("/admin/registro");
  return { success: true };
}
