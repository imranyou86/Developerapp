import { createClient } from "@/lib/supabase/server";
import { WarrantyRequestClient } from "@/app/projects/[id]/warranty-request/warranty-request-client";

export const dynamic = "force-dynamic";

export default async function WarrantyRequestPage({ params }: { params: { id: string } }) {
  const supabase = createClient();

  const { data: items, error } = await supabase
    .from("checklist_items")
    .select("id, title, done, comment, sort_order, checklist_photos ( id, storage_url )")
    .eq("project_id", params.id)
    .eq("phase", "warranty")
    .order("sort_order", { ascending: true });

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          Could not load warranty requests: {error.message}
        </div>
      )}
      <WarrantyRequestClient projectId={params.id} initialItems={items ?? []} />
    </div>
  );
}
