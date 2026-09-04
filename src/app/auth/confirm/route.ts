import { type EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Endpoint al que apuntan los links de los emails de Supabase Auth
// (confirmación de registro y recuperación de contraseña). Ver
// supabase/README.md para configurar el template de email correspondiente.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/";

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });

    if (!error) {
      redirect(type === "recovery" ? "/actualizar-password" : next);
    }
  }

  redirect("/login?error=enlace_invalido");
}
