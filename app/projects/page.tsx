import { createClient } from "@/lib/supabase/server";
import { ProjectsClient, type ProjectSummary } from "@/app/projects/projects-client";
import { TopNav } from "@/components/TopNav";
import { getCurrentUser, getAllowedTabSlugs } from "@/lib/permissions-server";
import { TOP_LEVEL_TABS } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const currentUser = await getCurrentUser();
  const allowedTopLevel = currentUser ? await getAllowedTabSlugs(currentUser.role, TOP_LEVEL_TABS) : [];

  const { data, error } = await supabase
    .from("projects")
    .select(
      `id, name, address, created_at,
       rooms ( id, tasks ( id, done ), budget_items ( id, budgeted, actual ) )`
    )
    .order("created_at", { ascending: false });

  const summaries: ProjectSummary[] = (data ?? []).map((p) => {
    const rooms = p.rooms ?? [];
    let tasksDone = 0;
    let tasksTotal = 0;
    let budgeted = 0;
    let actual = 0;
    for (const room of rooms) {
      for (const t of room.tasks ?? []) {
        tasksTotal++;
        if (t.done) tasksDone++;
      }
      for (const b of room.budget_items ?? []) {
        budgeted += Number(b.budgeted ?? 0);
        actual += Number(b.actual ?? 0);
      }
    }
    return {
      id: p.id,
      name: p.name,
      address: p.address,
      roomCount: rooms.length,
      tasksDone,
      tasksTotal,
      budgeted,
      actual,
    };
  });

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
        {error && (
          <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            Could not load projects: {error.message}
          </div>
        )}
        <ProjectsClient projects={summaries} />
      </main>
    </div>
  );
}
