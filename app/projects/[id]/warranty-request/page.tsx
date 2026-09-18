import { createClient } from "@/lib/supabase/server";
import { signRowsUrl } from "@/lib/storage";
import { getCurrentUser } from "@/lib/permissions-server";
import { WarrantyRequestClient } from "@/app/projects/[id]/warranty-request/warranty-request-client";
import { CreateWarrantyRequestForm } from "@/app/projects/[id]/warranty-request/create-warranty-request-form";
import { MyWarrantyRequests } from "@/app/projects/[id]/warranty-request/my-warranty-requests";

export const dynamic = "force-dynamic";

export default async function WarrantyRequestPage({ params }: { params: { id: string } }) {
  const currentUser = await getCurrentUser();
  const viewerRole = currentUser?.role ?? "owner";

  // The 'warranty' role gets a single-purpose submission form plus a
  // read-only view of its own filed requests — not the Contractor/
  // Developer/PM tracking dashboard below (no other warranty account's
  // requests, no checklist, no editing controls). Branching here (not just
  // hiding sections client-side) means the full-project data queried below
  // is never sent to this viewer in the first place.
  if (viewerRole === "warranty") {
    const supabase = createClient();
    const { data: requests, error: requestsError } = await supabase
      .from("warranty_item_requests")
      .select(
        "id, project_id, title, comment, category, requested_by, status, progress, subcontractor_id, checklist_item_id, reviewed_by, reviewed_at, scheduled_date, scheduled_time_start, scheduled_time_end, created_at"
      )
      .eq("project_id", params.id)
      .eq("requested_by", currentUser?.id ?? "")
      .order("created_at", { ascending: false });

    const requestIds = (requests ?? []).map((r) => r.id);
    const [{ data: comments, error: commentsError }, { data: reports }] = await Promise.all([
      requestIds.length > 0
        ? supabase
            .from("warranty_item_request_comments")
            .select("id, request_id, user_id, sender_email, sender_name, body, created_at")
            .in("request_id", requestIds)
            .order("created_at", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      requestIds.length > 0
        ? supabase
            .from("inspection_reports")
            .select("id, project_id, checklist_item_id, warranty_item_request_id, file_name, storage_url, created_at")
            .in("warranty_item_request_id", requestIds)
        : Promise.resolve({ data: [] }),
    ]);

    // Resolved by whatever subcontractor_id is actually assigned to one of
    // this account's own requests — not by project_subcontractors links —
    // since a Contractor/Developer/PM can now assign any subcontractor
    // from the shared directory, not just ones already linked to this
    // project.
    const subIds = Array.from(new Set((requests ?? []).map((r) => r.subcontractor_id).filter((id): id is string => !!id)));
    const { data: subcontractors } =
      subIds.length > 0
        ? await supabase
            .from("subcontractors")
            .select("id, company_name, contact_name, trade, phone, email")
            .in("id", subIds)
            .order("company_name")
        : { data: [] };

    const signedReports = await signRowsUrl(reports ?? [], "storage_url");

    return (
      <div className="mx-auto max-w-lg space-y-6">
        <CreateWarrantyRequestForm projectId={params.id} />
        {(requestsError || commentsError) && (
          <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            Could not load your requests: {(requestsError ?? commentsError)?.message}
          </div>
        )}
        <MyWarrantyRequests
          projectId={params.id}
          requests={requests ?? []}
          comments={comments ?? []}
          initialReports={signedReports}
          subcontractors={subcontractors ?? []}
          currentUserId={currentUser?.id ?? null}
        />
      </div>
    );
  }

  const supabase = createClient();

  const [{ data: items, error }, { data: reports, error: reportsError }, { data: requests, error: requestsError }] =
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
          "id, project_id, title, comment, category, requested_by, status, progress, subcontractor_id, checklist_item_id, reviewed_by, reviewed_at, scheduled_date, scheduled_time_start, scheduled_time_end, created_at"
        )
        .eq("project_id", params.id)
        .order("created_at", { ascending: false }),
    ]);

  const requestIds = (requests ?? []).map((r) => r.id);
  // Any subcontractor in the shared directory can be assigned to a
  // warranty request, not just ones already linked to this specific
  // project (subcontractors_select's RLS already lets any signed-in user
  // read the whole directory) — a Contractor/Developer/PM fixing a
  // warranty item may want to bring in a sub who hasn't worked this
  // construction before.
  const [{ data: comments, error: commentsError }, { data: subcontractors }] = await Promise.all([
    requestIds.length > 0
      ? supabase
          .from("warranty_item_request_comments")
          .select("id, request_id, user_id, sender_email, sender_name, body, created_at")
          .in("request_id", requestIds)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    supabase.from("subcontractors").select("id, company_name, contact_name, trade, phone, email").order("company_name"),
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
