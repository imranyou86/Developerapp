import { redirect } from "next/navigation";
import { getCurrentUser, getAllowedTabSlugs } from "@/lib/permissions-server";
import { TOP_LEVEL_TABS } from "@/lib/permissions";

// Guards /landscape — a top-level section (next to Construction Cost),
// gated by the same Developer-editable tab_permissions matrix as the
// per-project tabs (see lib/permissions.ts's TOP_LEVEL_TABS). Every design
// still belongs to a specific construction (landscape_designs.project_id),
// so the page itself starts with a project picker rather than being scoped
// by a project id in the URL.
export default async function LandscapeLayout({ children }: { children: React.ReactNode }) {
  const currentUser = await getCurrentUser();
  if (!currentUser) redirect("/login?next=/landscape");

  const allowed = await getAllowedTabSlugs(currentUser.role, TOP_LEVEL_TABS);
  if (!allowed.includes("landscape")) redirect("/projects");

  return <>{children}</>;
}
