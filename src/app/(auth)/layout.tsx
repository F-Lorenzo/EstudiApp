import type { ReactNode } from "react";
import { PublicShell } from "@/components/site-shell";
import { getViewer } from "@/lib/auth/viewer";

export default async function AuthLayout({
  children,
}: {
  children: ReactNode;
}) {
  const viewer = await getViewer();
  return <PublicShell viewer={viewer}>{children}</PublicShell>;
}
