import { createClient } from "@/lib/supabase/server";
import { CostClient } from "@/app/projects/[id]/cost/cost-client";

export const dynamic = "force-dynamic";

export default async function CostPage({ params }: { params: { id: string } }) {
  const supabase = createClient();

  const [{ data: project }, { data: planPages }, { data: rooms }, { data: estimates, error }] = await Promise.all([
    supabase.from("projects").select("address").eq("id", params.id).single(),
    supabase
      .from("plan_pages")
      .select("id, storage_url, label")
      .eq("project_id", params.id)
      .eq("is_layout", true)
      .order("sort_order"),
    supabase.from("rooms").select("width, depth").eq("project_id", params.id),
    supabase
      .from("cost_estimates")
      .select("*")
      .eq("project_id", params.id)
      .order("created_at", { ascending: false }),
  ]);

  const roomsSqftHint = (rooms ?? []).reduce((sum, r) => {
    if (r.width && r.depth) return sum + Number(r.width) * Number(r.depth);
    return sum;
  }, 0);

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          Could not load cost estimate history: {error.message}
        </div>
      )}
      <CostClient
        projectId={params.id}
        projectAddress={project?.address ?? null}
        planPages={planPages ?? []}
        roomsSqftHint={roomsSqftHint > 0 ? roomsSqftHint : null}
        initialEstimates={estimates ?? []}
      />
    </div>
  );
}
