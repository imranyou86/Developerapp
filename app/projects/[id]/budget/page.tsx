import { createClient } from "@/lib/supabase/server";
import { BudgetClient } from "@/app/projects/[id]/budget/budget-client";

export const dynamic = "force-dynamic";

export default async function BudgetPage({ params }: { params: { id: string } }) {
  const supabase = createClient();

  const { data: rooms, error } = await supabase
    .from("rooms")
    .select("id, name, budget_items ( id, item, budgeted, actual, finish_id )")
    .eq("project_id", params.id)
    .order("name", { ascending: true });

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          Could not load budget: {error.message}
        </div>
      )}
      <BudgetClient projectId={params.id} initialRooms={rooms ?? []} />
    </div>
  );
}
