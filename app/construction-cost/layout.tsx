import { redirect } from "next/navigation";
import { getCurrentUser, getAllowedTabSlugs } from "@/lib/permissions-server";
import { TOP_LEVEL_TABS } from "@/lib/permissions";

// Construction Cost is a top-level section (not a per-project tab) gated
// by the same Developer-editable tab_permissions matrix as Buyers Guide/
// Interior Design/Subcontractors — see lib/permissions.ts's TOP_LEVEL_TABS.
export default async function ConstructionCostLayout({ children }: { children: React.ReactNode }) {
  const currentUser = await getCurrentUser();
  if (!currentUser) redirect("/login?next=/construction-cost");

  const allowed = await getAllowedTabSlugs(currentUser.role, TOP_LEVEL_TABS);
  if (!allowed.includes("cost")) redirect("/projects");

  return <>{children}</>;
}
