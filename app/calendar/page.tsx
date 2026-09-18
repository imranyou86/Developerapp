import { createClient } from "@/lib/supabase/server";
import { TopNav } from "@/components/TopNav";
import { BrandMark } from "@/components/BrandMark";
import { CalendarClient, type CalendarTask } from "@/app/calendar/calendar-client";
import { getCurrentUser, getAllowedTabSlugs } from "@/lib/permissions-server";
import { TOP_LEVEL_TABS } from "@/lib/permissions";

export const dynamic = "force-dynamic";

interface TaskRow {
  id: string;
  title: string;
  due_date: string;
  rooms: { id: string; name: string; project_id: string; projects: { name: string }[] | null }[] | null;
}

// Not gated by tab_permissions — same reasoning as /search, this is a
// utility view over data every visible task's own RLS already scopes.
export default async function CalendarPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const currentUser = await getCurrentUser();
  const allowedTopLevel = currentUser ? await getAllowedTabSlugs(currentUser.role, TOP_LEVEL_TABS, currentUser.id) : [];

  const [{ data: projects }, { data: taskRows, error }] = await Promise.all([
    supabase.from("projects").select("id, name").order("name"),
    supabase
      .from("tasks")
      .select("id, title, due_date, rooms(id, name, project_id, projects(name))")
      .eq("done", false)
      .not("due_date", "is", null)
      .order("due_date"),
  ]);

  // Only room tasks carry a real due date anywhere in this app (checklist/
  // warranty items, bids, etc. don't) — tasks_member RLS (has_project_access
  // via the parent room) already scoped this to what the signed-in user
  // can see, same as every other query here.
  const tasks: CalendarTask[] = ((taskRows ?? []) as unknown as TaskRow[])
    .map((t) => {
      const room = t.rooms?.[0];
      if (!room) return null;
      return {
        id: t.id,
        title: t.title,
        dueDate: t.due_date,
        roomName: room.name,
        projectId: room.project_id,
        projectName: room.projects?.[0]?.name ?? "Untitled construction",
      };
    })
    .filter((t): t is CalendarTask => t !== null);

  return (
    <div className="min-h-screen bg-concrete">
      <header className="border-b border-blueprint/10 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <BrandMark />
            <div>
              <h1 className="text-lg font-semibold text-blueprint-dark">Alaia Homes Dev</h1>
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
          showAdmin={currentUser?.isDeveloper}
          showDeals={allowedTopLevel.includes("deals")}
          showInteriorDesign={allowedTopLevel.includes("interior-design")}
          showConstructionCost={allowedTopLevel.includes("cost")}
          showLandscape={allowedTopLevel.includes("landscape")}
          showSubcontractors={allowedTopLevel.includes("subcontractors")}
        />
      </header>

      <main className="mx-auto max-w-5xl animate-fade-in-up px-6 py-8">
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-blueprint-dark">Calendar</h2>
          <p className="text-sm text-blueprint/50">
            Every open room task with a due date, across every construction you have access to — overdue first,
            then this week, then everything later. Pick a construction below to narrow it to just that one.
          </p>
        </div>
        {error && (
          <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            Could not load the calendar: {error.message}
          </div>
        )}
        <CalendarClient tasks={tasks} projects={projects ?? []} />
      </main>
    </div>
  );
}
