import { createClient } from "@/lib/supabase/server";
import { signRowsUrl } from "@/lib/storage";
import { TopNav } from "@/components/TopNav";
import { BrandMark } from "@/components/BrandMark";
import { CostSections } from "@/app/construction-cost/cost-sections";
import { getCurrentUser, getAllowedTabSlugs } from "@/lib/permissions-server";
import { TOP_LEVEL_TABS } from "@/lib/permissions";
import type { CostEstimate, PlanPage } from "@/lib/types";

export const dynamic = "force-dynamic";

const PLAN_PAGE_COLUMNS = "id, project_id, created_by, storage_url, label, sort_order, is_layout, created_at";

export default async function ConstructionCostPage({ searchParams }: { searchParams: { project?: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const currentUser = await getCurrentUser();
  const allowedTopLevel = currentUser ? await getAllowedTabSlugs(currentUser.role, TOP_LEVEL_TABS, currentUser.id) : [];

  const { data: projects } = await supabase.from("projects").select("id, name, address").order("name");
  const projectList = projects ?? [];

  // Fall back to the only project when there's just one — otherwise
  // require an explicit pick, same call as Interior Design: a cost
  // estimate always belongs to one construction and there's no reasonable
  // default among several.
  const requested = searchParams.project;
  const selectedId = requested && projectList.some((p) => p.id === requested) ? requested : projectList.length === 1 ? projectList[0].id : null;

  let projectAddress: string | null = null;
  let planPages: PlanPage[] = [];
  let roomsSqftHint: number | null = null;
  let estimates: CostEstimate[] = [];
  let loadError: string | null = null;

  if (selectedId) {
    const [{ data: project }, { data: pages }, { data: rooms }, { data: estimateRows, error }] = await Promise.all([
      supabase.from("projects").select("address").eq("id", selectedId).single(),
      supabase.from("plan_pages").select(PLAN_PAGE_COLUMNS).eq("project_id", selectedId).eq("is_layout", true).order("sort_order"),
      supabase.from("rooms").select("width, depth").eq("project_id", selectedId),
      supabase.from("cost_estimates").select("*").eq("project_id", selectedId).order("created_at", { ascending: false }),
    ]);

    projectAddress = project?.address ?? null;
    planPages = (await signRowsUrl((pages ?? []) as PlanPage[], "storage_url")) as PlanPage[];
    const sqft = (rooms ?? []).reduce((sum, r) => (r.width && r.depth ? sum + Number(r.width) * Number(r.depth) : sum), 0);
    roomsSqftHint = sqft > 0 ? sqft : null;
    estimates = (estimateRows ?? []) as CostEstimate[];
    loadError = error?.message ?? null;
  }

  // Standalone mode — a plan not tied to any tracked construction. Scoped
  // to this user's own uploads/estimates (see migration 051), not a shared
  // directory: unlike Landscape's "Standalone Photos," this is a working
  // set of plan pages plus a running estimate history, not a one-off
  // reference image meant for teammates to browse.
  let standalonePages: PlanPage[] = [];
  let standaloneEstimates: CostEstimate[] = [];
  if (user) {
    const [{ data: pages }, { data: estimateRows }] = await Promise.all([
      supabase.from("plan_pages").select(PLAN_PAGE_COLUMNS).is("project_id", null).eq("created_by", user.id).order("sort_order"),
      supabase.from("cost_estimates").select("*").is("project_id", null).eq("created_by", user.id).order("created_at", { ascending: false }),
    ]);
    standalonePages = (await signRowsUrl((pages ?? []) as PlanPage[], "storage_url")) as PlanPage[];
    standaloneEstimates = (estimateRows ?? []) as CostEstimate[];
  }

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
          showDeals={allowedTopLevel.includes("deals")}
          showInteriorDesign={allowedTopLevel.includes("interior-design")}
          showConstructionCost={allowedTopLevel.includes("cost")}
          showLandscape={allowedTopLevel.includes("landscape")}
          showSubcontractors={allowedTopLevel.includes("subcontractors")}
        />
      </header>

      <main className="mx-auto max-w-5xl animate-fade-in-up px-6 py-8">
        <CostSections
          projectList={projectList}
          selectedId={selectedId}
          projectAddress={projectAddress}
          planPages={planPages}
          roomsSqftHint={roomsSqftHint}
          estimates={estimates}
          loadError={loadError}
          standalonePages={standalonePages}
          standaloneEstimates={standaloneEstimates}
        />
      </main>
    </div>
  );
}
