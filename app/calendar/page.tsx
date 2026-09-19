import { createClient } from "@/lib/supabase/server";
import { TopNav } from "@/components/TopNav";
import { BrandMark } from "@/components/BrandMark";
import { CalendarClient, type CalendarEntry } from "@/app/calendar/calendar-client";
import { getCurrentUser, getAllowedTabSlugs } from "@/lib/permissions-server";
import { TOP_LEVEL_TABS } from "@/lib/permissions";

export const dynamic = "force-dynamic";

interface TaskRow {
  id: string;
  title: string;
  due_date: string;
  rooms: { id: string; name: string; project_id: string; projects: { name: string }[] | null }[] | null;
}

interface WarrantyVisitRow {
  id: string;
  project_id: string;
  title: string;
  scheduled_date: string;
  scheduled_time_start: string | null;
  scheduled_time_end: string | null;
  projects: { name: string }[] | null;
  subcontractors: { company_name: string }[] | null;
}

interface CalendarEventRow {
  id: string;
  project_id: string;
  title: string;
  notes: string | null;
  event_date: string;
  time_start: string | null;
  time_end: string | null;
  created_by: string;
  projects: { name: string }[] | null;
}

// Not gated by tab_permissions — same reasoning as /search, this is a
// utility view over data every visible entry's own RLS already scopes.
export default async function CalendarPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const currentUser = await getCurrentUser();
  const allowedTopLevel = currentUser ? await getAllowedTabSlugs(currentUser.role, TOP_LEVEL_TABS, currentUser.id) : [];

  const [
    { data: projects },
    { data: taskRows, error },
    { data: visitRows, error: visitsError },
    { data: eventRows, error: eventsError },
  ] = await Promise.all([
    supabase.from("projects").select("id, name").order("name"),
    supabase
      .from("tasks")
      .select("id, title, due_date, rooms(id, name, project_id, projects(name))")
      .eq("done", false)
      .not("due_date", "is", null)
      .order("due_date"),
    // can_view_warranty_request's RLS (same as the Warranty Request tab)
    // already scopes this to what the signed-in user can see — a 'warranty'
    // account only ever gets its own filed requests, everyone else with
    // project access gets all of them. A visit already marked complete
    // drops off here the same way a done task drops off above.
    supabase
      .from("warranty_item_requests")
      .select(
        "id, project_id, title, scheduled_date, scheduled_time_start, scheduled_time_end, projects(name), subcontractors(company_name)"
      )
      .not("scheduled_date", "is", null)
      .neq("progress", "complete")
      .order("scheduled_date"),
    // has_project_access RLS (calendar_events_select, migration 056) scopes
    // this to constructions the signed-in user actually has access to.
    supabase
      .from("calendar_events")
      .select("id, project_id, title, notes, event_date, time_start, time_end, created_by, projects(name)")
      .order("event_date"),
  ]);

  // Only room tasks carry a real due date anywhere else in this app
  // (checklist items, bids, etc. don't) — tasks_member RLS (has_project_access
  // via the parent room) already scoped this to what the signed-in user
  // can see, same as every other query here.
  const taskEntries: CalendarEntry[] = ((taskRows ?? []) as unknown as TaskRow[])
    .map((t) => {
      const room = t.rooms?.[0];
      if (!room) return null;
      const entry: CalendarEntry = {
        id: `task-${t.id}`,
        kind: "task",
        title: t.title,
        dueDate: t.due_date,
        timeStart: null,
        timeEnd: null,
        subLabel: `${room.name} — ${room.projects?.[0]?.name ?? "Untitled construction"}`,
        projectId: room.project_id,
        href: `/projects/${room.project_id}/rooms`,
      };
      return entry;
    })
    .filter((t): t is CalendarEntry => t !== null);

  const visitEntries: CalendarEntry[] = ((visitRows ?? []) as unknown as WarrantyVisitRow[]).map((v) => ({
    id: `visit-${v.id}`,
    kind: "warranty_visit",
    title: v.title,
    dueDate: v.scheduled_date,
    timeStart: v.scheduled_time_start,
    timeEnd: v.scheduled_time_end,
    subLabel: `${v.subcontractors?.[0]?.company_name ?? "Subcontractor TBD"} — ${v.projects?.[0]?.name ?? "Untitled construction"}`,
    projectId: v.project_id,
    href: `/projects/${v.project_id}/warranty-request`,
  }));

  const eventEntries: CalendarEntry[] = ((eventRows ?? []) as unknown as CalendarEventRow[]).map((ev) => ({
    id: `event-${ev.id}`,
    kind: "event",
    eventId: ev.id,
    title: ev.title,
    dueDate: ev.event_date,
    timeStart: ev.time_start,
    timeEnd: ev.time_end,
    subLabel: ev.projects?.[0]?.name ?? "Untitled construction",
    notes: ev.notes,
    createdBy: ev.created_by,
    projectId: ev.project_id,
    href: null,
  }));

  const entries = [...taskEntries, ...visitEntries, ...eventEntries].sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  return (
    <div className="min-h-screen bg-concrete">
      <header className="border-b border-blueprint/10 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-y-2 px-6 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <BrandMark />
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-blueprint-dark">Alaia Homes Dev</h1>
              <p className="truncate text-xs text-blueprint/50">{user?.email}</p>
            </div>
          </div>
          <form action="/auth/signout" method="post" className="shrink-0">
            <button type="submit" className="btn-ghost">
              Sign out
            </button>
          </form>
        </div>
        <TopNav
          showAdmin={currentUser?.isDeveloper}
          showSearch={currentUser?.role !== "warranty"}
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
            Every open room task with a due date, every scheduled warranty visit (🔧), and every meeting or site visit
            (📅) anyone&apos;s added — across every construction you have access to. Overdue first, then this week,
            then everything later. Pick a construction below to narrow it to just that one.
          </p>
        </div>
        {(error || visitsError || eventsError) && (
          <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            Could not load the calendar: {(error ?? visitsError ?? eventsError)?.message}
          </div>
        )}
        <CalendarClient
          entries={entries}
          projects={projects ?? []}
          currentUserId={currentUser?.id ?? null}
          canAddEvents={!!currentUser && currentUser.role !== "warranty"}
        />
      </main>
    </div>
  );
}
