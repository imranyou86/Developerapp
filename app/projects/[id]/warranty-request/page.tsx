import { createClient } from "@/lib/supabase/server";
import { signRowsUrl } from "@/lib/storage";
import { getCurrentUser } from "@/lib/permissions-server";
import { WarrantyRequestClient } from "@/app/projects/[id]/warranty-request/warranty-request-client";
import { CreateWarrantyRequestForm } from "@/app/projects/[id]/warranty-request/create-warranty-request-form";

export const dynamic = "force-dynamic";

export default async function WarrantyRequestPage({ params }: { params: { id: string } }) {
  const currentUser = await getCurrentUser();
  const viewerRole = currentUser?.role ?? "owner";

  // The 'warranty' role gets a single-purpose submission form instead of
  // the tracking dashboard below — no request list, no status, no
  // comments, no subcontractor. Branching here (not just hiding sections
  // client-side) means none of that data is ever queried or sent to this
  // viewer in the first place, not just visually hidden.
  if (viewerRole === "warranty") {
    return (
      <div>
        <CreateWarrantyRequestForm projectId={params.id} />
      </div>
    );
  }

  const supabase = createClient();

  const [{ data: items, error }, { data: reports, error: reportsError }, { data: requests, error: requestsError }, { data: subLinks }] =
    await Promise.all([
      supabase
        .from("checklist_items")
        .select("id, title, done, status, comment, sort_order, checklist_photos ( id, storage_url )")
        .eq("project_id", params.id)
        .eq("phase", "warranty")
        .order("sort_order", { ascending: true }),
      supabase
        .from("inspection_reports")
        .select("id, project_id, checklist_item_id, warranty_item_request_id, file_name, storage_url, created_at")
        .eq("project_id", params.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("warranty_item_requests")
        .select(
          "id, project_id, title, comment, category, requested_by, status, progress, subcontractor_id, checklist_item_id, reviewed_by, reviewed_at, created_at"
        )
        .eq("project_id", params.id)
        .order("created_at", { ascending: false }),
      // Only this project's own linked subs — same pattern house-book/page.tsx
      // uses — not the whole shared subcontractor directory.
      supabase.from("project_subcontractors").select("subcontractor_id").eq("project_id", params.id),
    ]);

  const requestIds = (requests ?? []).map((r) => r.id);
  const subIds = (subLinks ?? []).map((l) => l.subcontractor_id);
  const [{ data: comments, error: commentsError }, { data: subcontractors }] = await Promise.all([
    requestIds.length > 0
      ? supabase
          .from("warranty_item_request_comments")
          .select("id, request_id, user_id, sender_email, body, created_at")
          .in("request_id", requestIds)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    subIds.length > 0
      ? supabase.from("subcontractors").select("id, company_name, trade").in("id", subIds).order("company_name")
      : Promise.resolve({ data: [] }),
  ]);

  const [signedItems, signedReports] = await Promise.all([
    Promise.all(
      (items ?? []).map(async (item) => ({
        ...item,
        checklist_photos: await signRowsUrl(item.checklist_photos ?? [], "storage_url"),
      }))
    ),
    signRowsUrl(reports ?? [], "storage_url"),
  ]);

  return (
    <div>
      {(error || reportsError || requestsError || commentsError) && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          Could not load warranty requests: {(error ?? reportsError ?? requestsError ?? commentsError)?.message}
        </div>
      )}
      <WarrantyRequestClient
        projectId={params.id}
        initialItems={signedItems}
        initialReports={signedReports}
        initialRequests={requests ?? []}
        initialComments={comments ?? []}
        subcontractors={subcontractors ?? []}
        viewerRole={viewerRole}
        currentUserId={currentUser?.id ?? null}
      />
    </div>
  );
}
