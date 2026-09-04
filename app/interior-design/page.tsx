import { createClient } from "@/lib/supabase/server";
import { TopNav } from "@/components/TopNav";
import { ProjectPicker } from "@/app/interior-design/project-picker";
import { InteriorDesignClient } from "@/app/interior-design/interior-design-client";
import { getCurrentUser, getAllowedTabSlugs } from "@/lib/permissions-server";
import { TOP_LEVEL_TABS } from "@/lib/permissions";

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
  // construction and there's no reasonable default among several.
  const requested = searchParams.project;
  const selectedId = requested && projectList.some((p) => p.id === requested) ? requested : projectList.length === 1 ? projectList[0].id : null;

  let rooms: { id: string; name: string; type: string | null; width: number | null; depth: number | null }[] = [];
  let designs: Awaited<ReturnType<typeof loadDesigns>> = [];
  if (selectedId) {
    [rooms, designs] = await Promise.all([loadRooms(selectedId), loadDesigns(selectedId)]);
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
        />
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-6">
          <h2 className="mb-1 text-lg font-semibold text-blueprint-dark">Interior Design</h2>
          <p className="mb-3 text-sm text-blueprint/50">
            Pick which construction this design is for — sizing can come from that project&apos;s pre-added rooms.
          </p>
          {projectList.length === 0 ? (
            <p className="text-sm text-blueprint/50">
              No constructions yet — create one under Constructions first, then come back here.
            </p>
          ) : (
            <ProjectPicker projects={projectList} selectedId={selectedId} />
          )}
        </div>

        {selectedId && (
          <InteriorDesignClient key={selectedId} projectId={selectedId} initialDesigns={designs} rooms={rooms} />
        )}
      </main>
    </div>
  );
}

async function loadRooms(projectId: string) {
  const supabase = createClient();
  const { data } = await supabase.from("rooms").select("id, name, type, width, depth").eq("project_id", projectId).order("name");
  return data ?? [];
}

async function loadDesigns(projectId: string) {
  const supabase = createClient();
  const { data } = await supabase
    .from("interior_designs")
    .select(
      "id, project_id, room_id, room_type, style, width, depth, sqft, original_photo_url, generated_image_url, prompt, created_at"
    )
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  return data ?? [];
}
