import { redirect } from "next/navigation";
import { getCurrentUser, getAllowedTabSlugs } from "@/lib/permissions-server";
import { TOP_LEVEL_TABS } from "@/lib/permissions";

// Subcontractors is a top-level section gated by the same Developer-editable
// tab_permissions matrix as Buyers Guide/Interior Design — see
// lib/permissions.ts's TOP_LEVEL_TABS.
export default async function SubcontractorsLayout({ children }: { children: React.ReactNode }) {
  const currentUser = await getCurrentUser();
  if (!currentUser) redirect("/login?next=/subcontractors");

  const allowed = await getAllowedTabSlugs(currentUser.role, TOP_LEVEL_TABS);
  if (!allowed.includes("subcontractors")) redirect("/projects");

  return <>{children}</>;
}
