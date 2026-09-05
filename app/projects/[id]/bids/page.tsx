import { createClient } from "@/lib/supabase/server";
import { BidsClient } from "@/app/projects/[id]/bids/bids-client";

export const dynamic = "force-dynamic";

export default async function BidsPage({ params }: { params: { id: string } }) {
  const supabase = createClient();

  const [{ data: bids, error }, { data: project }] = await Promise.all([
    supabase
      .from("bids")
      .select(
        `id, contractor, total_amount, file_name, file_url, uploaded_at, status,
         evaluation_verdict, evaluation_confidence, evaluation_market_low, evaluation_market_high, evaluation_analysis,
         payment_schedule_items ( id, label, amount )`
      )
      .eq("project_id", params.id)
      .neq("status", "accepted")
      .order("uploaded_at", { ascending: false }),
    supabase.from("projects").select("address").eq("id", params.id).single(),
  ]);

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          Could not load bids: {error.message}
        </div>
      )}
      <BidsClient projectId={params.id} initialBids={bids ?? []} projectAddress={project?.address ?? null} />
    </div>
  );
}
