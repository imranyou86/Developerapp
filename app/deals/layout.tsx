import { redirect } from "next/navigation";
import { getCurrentUser, getAllowedTabSlugs } from "@/lib/permissions-server";
import { TOP_LEVEL_TABS } from "@/lib/permissions";

// Guards both /deals and /deals/[id] — Buyers Guide is a top-level section
// gated by the same Developer-editable tab_permissions matrix as the
// per-project tabs (see lib/permissions.ts's TOP_LEVEL_TABS), just without
// a project id in the URL to scope it to.
export default async function DealsLayout({ children }: { children: React.ReactNode }) {
  const currentUser = await getCurrentUser();
  if (!currentUser) redirect("/login?next=/deals");

  const allowed = await getAllowedTabSlugs(currentUser.role, TOP_LEVEL_TABS);
  if (!allowed.includes("deals")) redirect("/projects");

  return <>{children}</>;
}
