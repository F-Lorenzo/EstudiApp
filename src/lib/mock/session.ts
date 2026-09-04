// MOCK — sesión basada en una cookie con el id de perfil, sin JWT ni
// Supabase Auth. Solo para la demo sin base de datos.

import { cookies } from "next/headers";
import { getProfile } from "./queries";

export const SESSION_COOKIE = "mock_session";

export async function getMockSession() {
  const cookieStore = await cookies();
  const userId = cookieStore.get(SESSION_COOKIE)?.value;
  if (!userId) return null;
  return getProfile(userId);
}

export async function setMockSession(userId: string) {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, userId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
}

export async function clearMockSession() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}
