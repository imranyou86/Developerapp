import { createClient } from "@/lib/supabase/server";
import { ensureChecklistSeeded } from "@/app/projects/[id]/checklist/actions";
import { ChecklistClient } from "@/app/projects/[id]/checklist/checklist-client";

export const dynamic = "force-dynamic";

export default async function ChecklistPage({ params }: { params: { id: string } }) {
  await ensureChecklistSeeded(params.id);

  const supabase = createClient();
  const { data: items, error } = await supabase
    .from("checklist_items")
    .select("id, phase, title, done, comment, sort_order, checklist_photos ( id, storage_url )")
    .eq("project_id", params.id)
    .order("sort_order", { ascending: true });

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          Could not load checklist: {error.message}
        </div>
      )}
      <ChecklistClient projectId={params.id} initialItems={items ?? []} />
    </div>
  );
}
