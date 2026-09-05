import { createClient } from "@/lib/supabase/server";
import { DealsClient } from "@/app/deals/deals-client";
import { TopNav } from "@/components/TopNav";
import { BrandMark } from "@/components/BrandMark";
import { getCurrentUser, getAllowedTabSlugs } from "@/lib/permissions-server";
import { TOP_LEVEL_TABS } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function DealsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const currentUser = await getCurrentUser();
  const allowedTopLevel = currentUser ? await getAllowedTabSlugs(currentUser.role, TOP_LEVEL_TABS) : [];
  const { data: deals, error } = await supabase
    .from("deals")
    .select("id, address, city, state, zip_code, list_price, beds, baths, sqft, year_built, status, project_id, created_at")
    .order("created_at", { ascending: false });

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
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-blueprint-dark">Buyers Guide</h2>
          <p className="text-sm text-blueprint/50">
            Search homes for sale by ZIP code, pull comps, and evaluate whether a remodel or
            ground-up rebuild pencils out before you buy.
          </p>
        </div>
        {error && (
          <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            Could not load saved deals: {error.message}
          </div>
        )}
        <DealsClient initialDeals={deals ?? []} />
      </main>
    </div>
  );
}
