"use server";

import { redirect } from "next/navigation";
import { clearMockSession } from "@/lib/mock/session";

export async function signOut() {
  await clearMockSession();
  redirect("/login");
}
