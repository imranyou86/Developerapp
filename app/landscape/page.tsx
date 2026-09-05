import { createClient } from "@/lib/supabase/server";
import { TopNav } from "@/components/TopNav";
import { BrandMark } from "@/components/BrandMark";
import { LandscapeSections } from "@/app/landscape/landscape-sections";
import { getCurrentUser, getAllowedTabSlugs } from "@/lib/permissions-server";
import { TOP_LEVEL_TABS } from "@/lib/permissions";
import type { LandscapeDesign } from "@/lib/types";

const LANDSCAPE_DESIGN_COLUMNS = "id, project_id, style, components, notes, original_photo_url, generated_image_url, prompt, created_at";

export const dynamic = "force-dynamic";

export default async function LandscapePage({ searchParams }: { searchParams: { project?: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const currentUser = await getCurrentUser();
  const allowedTopLevel = currentUser ? await getAllowedTabSlugs(currentUser.role, TOP_LEVEL_TABS) : [];

  const { data: projects } = await supabase.from("projects").select("id, name, address").order("name");
  const projectList = projects ?? [];

  // Fall back to the only project when there's just one — otherwise require
  // an explicit pick, same as Interior Design/Construction Cost: a design
  // always belongs to one construction and there's no reasonable default
  // among several.
  const requested = searchParams.project;
  const selectedId = requested && projectList.some((p) => p.id === requested) ? requested : projectList.length === 1 ? projectList[0].id : null;

  let designs: LandscapeDesign[] = [];
  if (selectedId) {
    const { data } = await supabase
      .from("landscape_designs")
      .select(LANDSCAPE_DESIGN_COLUMNS)
      .eq("project_id", selectedId)
      .order("created_at", { ascending: false });
    designs = (data ?? []) as LandscapeDesign[];
  }

  const { data: standaloneData } = await supabase
    .from("landscape_designs")
    .select(LANDSCAPE_DESIGN_COLUMNS)
    .is("project_id", null)
    .order("created_at", { ascending: false });
  const standaloneDesigns = (standaloneData ?? []) as LandscapeDesign[];

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
        <h2 className="mb-1 text-lg font-semibold text-blueprint-dark">Landscape</h2>
        <LandscapeSections projectList={projectList} selectedId={selectedId} designs={designs} standaloneDesigns={standaloneDesigns} />
      </main>
    </div>
  );
}
