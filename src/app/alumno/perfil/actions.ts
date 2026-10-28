"use server";

import { revalidatePath } from "next/cache";
import { avatarError, removeOtherAvatars } from "@/lib/storage/server";
import { createClient } from "@/lib/supabase/server";
import { updateProfileSchema } from "@/lib/validation/auth";
import type { ActionState } from "@/lib/validation/form-state";

export async function updateProfile(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = updateProfileSchema.safeParse({
    fullName: formData.get("fullName"),
    avatarUrl: formData.get("avatarUrl") ?? "",
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Tu sesión expiró. Volvé a iniciar sesión." };
  }

  // La foto se sube desde el formulario (migración 0026): solo se guarda un archivo propio, o la que ya estaba.
  const { data: current } = await supabase.from("profiles").select("avatar_url").eq("id", user.id).single();
  const photoError = avatarError(parsed.data.avatarUrl, current?.avatar_url ?? null, user.id);
  if (photoError) {
    return { fieldErrors: { avatarUrl: [photoError] } };
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: parsed.data.fullName,
      avatar_url: parsed.data.avatarUrl || null,
    })
    .eq("id", user.id);

  if (error) {
    return { error: "No se pudieron guardar los cambios. Intentá de nuevo." };
  }

  await removeOtherAvatars(supabase, user.id, parsed.data.avatarUrl || null);
  revalidatePath("/alumno/perfil");
  return { success: true };
}
