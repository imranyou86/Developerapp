import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/permissions-server";
import { WarrantyRequestClient } from "@/app/projects/[id]/warranty-request/warranty-request-client";

export const dynamic = "force-dynamic";

export default async function WarrantyRequestPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const currentUser = await getCurrentUser();

  const [{ data: items, error }, { data: reports, error: reportsError }, { data: requests, error: requestsError }] = await Promise.all([
    supabase
      .from("checklist_items")
      .select("id, title, done, status, comment, sort_order, checklist_photos ( id, storage_url )")
      .eq("project_id", params.id)
      .eq("phase", "warranty")
      .order("sort_order", { ascending: true }),
    supabase
      .from("inspection_reports")
      .select("id, project_id, checklist_item_id, file_name, storage_url, created_at")
      .eq("project_id", params.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("warranty_item_requests")
      .select("id, project_id, title, comment, requested_by, status, checklist_item_id, reviewed_by, reviewed_at, created_at")
      .eq("project_id", params.id)
      .order("created_at", { ascending: false }),
  ]);

  return (
    <div>
      {(error || reportsError || requestsError) && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          Could not load warranty requests: {(error ?? reportsError ?? requestsError)?.message}
        </div>
      )}
      <WarrantyRequestClient
        projectId={params.id}
        initialItems={items ?? []}
        initialReports={reports ?? []}
        initialRequests={requests ?? []}
        viewerRole={currentUser?.role ?? "owner"}
      />
    </div>
  );
}
