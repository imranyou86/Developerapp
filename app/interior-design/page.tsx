import { createClient } from "@/lib/supabase/server";
import { TopNav } from "@/components/TopNav";
import { BrandMark } from "@/components/BrandMark";
import { InteriorDesignSections } from "@/app/interior-design/interior-design-sections";
import { getCurrentUser, getAllowedTabSlugs } from "@/lib/permissions-server";
import { TOP_LEVEL_TABS } from "@/lib/permissions";
import type { IdentifiedFinish } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function InteriorDesignPage({ searchParams }: { searchParams: { project?: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const currentUser = await getCurrentUser();
  const allowedTopLevel = currentUser ? await getAllowedTabSlugs(currentUser.role, TOP_LEVEL_TABS) : [];

  const { data: projects } = await supabase.from("projects").select("id, name, address").order("name");
  const projectList = projects ?? [];

  // Fall back to the only project when there's just one — otherwise require
  // an explicit pick, since interior_designs always belongs to one
  // construction and there's no reasonable default among several. Only
  // matters for the "Design a room" section — Finish ID is universal and
  // doesn't need a selected construction to work.
  const requested = searchParams.project;
  const selectedId = requested && projectList.some((p) => p.id === requested) ? requested : projectList.length === 1 ? projectList[0].id : null;

  let rooms: { id: string; name: string; type: string | null; width: number | null; depth: number | null }[] = [];
  let designs: Awaited<ReturnType<typeof loadDesigns>> = [];
  let planPages: { label: string; storage_url: string }[] = [];
  if (selectedId) {
    [rooms, designs, planPages] = await Promise.all([loadRooms(selectedId), loadDesigns(selectedId), loadPlanPages(selectedId)]);
  }

  const [scans, allRooms] = await Promise.all([loadFinishScans(), loadAllRooms()]);
  const roomsByProject: Record<string, { id: string; name: string }[]> = {};
  for (const r of allRooms) {
    (roomsByProject[r.project_id] ??= []).push({ id: r.id, name: r.name });
  }

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

      <main className="mx-auto max-w-5xl px-6 py-8">
        <h2 className="mb-1 text-lg font-semibold text-blueprint-dark">Interior Design</h2>
        <InteriorDesignSections
          projectList={projectList}
          selectedId={selectedId}
          rooms={rooms}
          designs={designs}
          planPages={planPages}
          scans={scans}
          roomsByProject={roomsByProject}
        />
      </main>
    </div>
  );
}

async function loadRooms(projectId: string) {
  const supabase = createClient();
  const { data } = await supabase.from("rooms").select("id, name, type, width, depth").eq("project_id", projectId).order("name");
  return data ?? [];
}

async function loadAllRooms() {
  const supabase = createClient();
  const { data } = await supabase.from("rooms").select("id, name, project_id").order("name");
  return data ?? [];
}

async function loadPlanPages(projectId: string) {
  const supabase = createClient();
  const { data } = await supabase
    .from("plan_pages")
    .select("label, storage_url")
    .eq("project_id", projectId)
    .eq("is_layout", true)
    .order("sort_order");
  return data ?? [];
}

async function loadDesigns(projectId: string) {
  const supabase = createClient();
  const { data } = await supabase
    .from("interior_designs")
    .select(
      "id, project_id, room_id, room_type, style, width, depth, sqft, layout, original_photo_url, generated_image_url, prompt, created_at"
    )
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  return data ?? [];
}

async function loadFinishScans(): Promise<{ id: string; storage_url: string; label: string | null; results: IdentifiedFinish[]; created_at: string }[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("finish_scans")
    .select("id, storage_url, label, results, created_at")
    .order("created_at", { ascending: false });
  return data ?? [];
}
