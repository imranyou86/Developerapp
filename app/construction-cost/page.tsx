import { createClient } from "@/lib/supabase/server";
import { TopNav } from "@/components/TopNav";
import { ProjectPicker } from "@/components/ProjectPicker";
import { CostClient } from "@/app/construction-cost/cost-client";
import { getCurrentUser, getAllowedTabSlugs } from "@/lib/permissions-server";
import { TOP_LEVEL_TABS } from "@/lib/permissions";
import type { CostEstimate } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ConstructionCostPage({ searchParams }: { searchParams: { project?: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const currentUser = await getCurrentUser();
  const allowedTopLevel = currentUser ? await getAllowedTabSlugs(currentUser.role, TOP_LEVEL_TABS) : [];

  const { data: projects } = await supabase.from("projects").select("id, name, address").order("name");
  const projectList = projects ?? [];

  // Fall back to the only project when there's just one — otherwise
  // require an explicit pick, same call as Interior Design: a cost
  // estimate always belongs to one construction and there's no reasonable
  // default among several.
  const requested = searchParams.project;
  const selectedId = requested && projectList.some((p) => p.id === requested) ? requested : projectList.length === 1 ? projectList[0].id : null;

  let projectAddress: string | null = null;
  let planPages: { id: string; storage_url: string; label: string }[] = [];
  let roomsSqftHint: number | null = null;
  let estimates: CostEstimate[] = [];
  let loadError: string | null = null;

  if (selectedId) {
    const [{ data: project }, { data: pages }, { data: rooms }, { data: estimateRows, error }] = await Promise.all([
      supabase.from("projects").select("address").eq("id", selectedId).single(),
      supabase
        .from("plan_pages")
        .select("id, storage_url, label")
        .eq("project_id", selectedId)
        .eq("is_layout", true)
        .order("sort_order"),
      supabase.from("rooms").select("width, depth").eq("project_id", selectedId),
      supabase.from("cost_estimates").select("*").eq("project_id", selectedId).order("created_at", { ascending: false }),
    ]);

    projectAddress = project?.address ?? null;
    planPages = pages ?? [];
    const sqft = (rooms ?? []).reduce((sum, r) => (r.width && r.depth ? sum + Number(r.width) * Number(r.depth) : sum), 0);
    roomsSqftHint = sqft > 0 ? sqft : null;
    estimates = (estimateRows ?? []) as CostEstimate[];
    loadError = error?.message ?? null;
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
          showConstructionCost={allowedTopLevel.includes("cost")}
          showSubcontractors={allowedTopLevel.includes("subcontractors")}
        />
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-6">
          <h2 className="mb-1 text-lg font-semibold text-blueprint-dark">Construction Cost</h2>
          <p className="mb-3 text-sm text-blueprint/50">
            Pick which construction to estimate — Claude reads that project&apos;s uploaded plan pages directly.
          </p>
          {projectList.length === 0 ? (
            <p className="text-sm text-blueprint/50">
              No constructions yet — create one under Constructions first, then come back here.
            </p>
          ) : (
            <ProjectPicker projects={projectList} selectedId={selectedId} basePath="/construction-cost" />
          )}
        </div>

        {selectedId && (
          <>
            {loadError && (
              <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
                Could not load cost estimate history: {loadError}
              </div>
            )}
            <CostClient
              key={selectedId}
              projectId={selectedId}
              projectAddress={projectAddress}
              planPages={planPages}
              roomsSqftHint={roomsSqftHint}
              initialEstimates={estimates}
            />
          </>
        )}
      </main>
    </div>
  );
}
