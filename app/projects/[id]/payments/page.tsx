import { createClient } from "@/lib/supabase/server";
import { PaymentsClient } from "@/app/projects/[id]/payments/payments-client";

export const dynamic = "force-dynamic";

export default async function PaymentsPage({ params }: { params: { id: string } }) {
  const supabase = createClient();

  // Only accepted bids show up here — bids awaiting a decision, or declined
  // ones, live on the Bids tab instead.
  const { data: bids, error } = await supabase
    .from("bids")
    .select("id, contractor, total_amount, file_name, file_url, uploaded_at, payment_schedule_items ( id, label, amount, paid )")
    .eq("project_id", params.id)
    .eq("status", "accepted")
    .order("uploaded_at", { ascending: false });

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          Could not load payments: {error.message}
        </div>
      )}
      <PaymentsClient projectId={params.id} initialBids={bids ?? []} />
    </div>
  );
}
