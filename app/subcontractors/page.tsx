import { createClient } from "@/lib/supabase/server";
import { SubcontractorsClient } from "@/app/subcontractors/subcontractors-client";
import { TopNav } from "@/components/TopNav";
import { getCurrentUser, getAllowedTabSlugs } from "@/lib/permissions-server";
import { TOP_LEVEL_TABS } from "@/lib/permissions";
import type { Subcontractor } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function SubcontractorsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const currentUser = await getCurrentUser();
  const allowedTopLevel = currentUser ? await getAllowedTabSlugs(currentUser.role, TOP_LEVEL_TABS) : [];

  const [{ data: subs, error }, { data: projects }, { data: links }] = await Promise.all([
    supabase
      .from("subcontractors")
      .select(
        "id, created_by, company_name, contact_name, trade, phone, email, address, license_number, license_state, reliability, cost_tier, notes, created_at"
      )
      .order("company_name"),
    // RLS (projects_select -> has_project_access) already scopes this to
    // whatever the signed-in user can see, same as the Constructions list.
    supabase.from("projects").select("id, name").order("name"),
    // Same RLS scoping via project_subcontractors_member — a link to a
    // project this user can't access simply won't come back, so the
    // per-sub project chips/checkboxes only ever show what's actually
    // visible to them.
    supabase.from("project_subcontractors").select("project_id, subcontractor_id"),
  ]);

  const projectsBySubId: Record<string, string[]> = {};
  for (const link of links ?? []) {
    (projectsBySubId[link.subcontractor_id] ??= []).push(link.project_id);
  }

  return (
    <div className="min-h-screen bg-concrete">
      <header className="border-b border-blueprint/10 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blueprint text-sm font-bold text-white">
              TD
            </div>
            <div>
              <h1 className="text-lg font-semibold text-blueprint-dark">The Developer</h1>
              <p className="text-xs text-blueprint/50">{user?.email}</p>
            </div>
          </div>
          <form action="/auth/signout" method="post">
            <button type="submit" className="btn-ghost">
              Sign out
            </button>
          </form>
        </div>
        <TopNav
          showAdmin={currentUser?.role === "developer"}
          showDeals={allowedTopLevel.includes("deals")}
          showInteriorDesign={allowedTopLevel.includes("interior-design")}
          showSubcontractors={allowedTopLevel.includes("subcontractors")}
        />
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-blueprint-dark">Subcontractors</h2>
          <p className="text-sm text-blueprint/50">
            A shared directory of subs — license info, contact details, and a reliability/cost tag from whoever&apos;s
            worked with them. Visible to everyone on the team; only whoever added an entry (or a Developer) can edit
            or remove it.
          </p>
        </div>
        {error && (
          <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            Could not load subcontractors: {error.message}
          </div>
        )}
        <SubcontractorsClient
          initialSubs={(subs ?? []) as Subcontractor[]}
          currentUserId={user?.id ?? ""}
          isDeveloper={!!currentUser?.isDeveloper}
          allProjects={projects ?? []}
          initialProjectsBySubId={projectsBySubId}
        />
      </main>
    </div>
  );
}
