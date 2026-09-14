import { createClient } from "@/lib/supabase/server";
import { BankTransactionsClient } from "@/app/projects/[id]/bank-transactions/bank-transactions-client";

export const dynamic = "force-dynamic";

export default async function BankTransactionsPage({ params }: { params: { id: string } }) {
  const supabase = createClient();

  const [{ data: transactions, error }, { data: bids }] = await Promise.all([
    supabase
      .from("bank_transactions")
      .select("id, project_id, bid_id, txn_date, description, amount, type, source_file_name, created_at")
      .eq("project_id", params.id)
      .order("txn_date", { ascending: false }),
    // Declined bids never received a payment — no point offering them as a
    // match target.
    supabase.from("bids").select("id, contractor, total_amount, status").eq("project_id", params.id).neq("status", "declined").order("contractor"),
  ]);

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          Could not load bank transactions: {error.message}
        </div>
      )}
      <BankTransactionsClient projectId={params.id} initialTransactions={transactions ?? []} bids={bids ?? []} />
    </div>
  );
}
