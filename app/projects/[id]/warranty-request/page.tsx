import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { signRowsUrl } from "@/lib/storage";
import { getCurrentUser } from "@/lib/permissions-server";
import { WarrantyRequestClient, type WarrantyMemberOption } from "@/app/projects/[id]/warranty-request/warranty-request-client";
import { CreateWarrantyRequestForm } from "@/app/projects/[id]/warranty-request/create-warranty-request-form";
import { MyWarrantyRequests } from "@/app/projects/[id]/warranty-request/my-warranty-requests";
import { WarrantyHomeownerTabs } from "@/app/projects/[id]/warranty-request/warranty-homeowner-tabs";

const REQUEST_COLUMNS =
  "id, project_id, title, comment, category, requested_by, status, progress, subcontractor_id, checklist_item_id, reviewed_by, reviewed_at, scheduled_date, scheduled_time_start, scheduled_time_end, rejection_note, is_group, group_id, created_at";

export const dynamic = "force-dynamic";

export default async function WarrantyRequestPage({ params }: { params: { id: string } }) {
  const currentUser = await getCurrentUser();
  const viewerRole = currentUser?.role ?? "owner";

  // The 'warranty' role gets a single-purpose submission form plus a
  // shared, read-only view of every warranty request on this construction
  // — not just the ones this specific account filed (see migration 058:
  // visibility is "assigned to this construction with this role," the same
  // boundary every other role already has, not "this is the account that
  // filed it" — so two warranty accounts on the same construction see the
  // exact same queue) — and not the Contractor/Developer/PM tracking
  // dashboard below (no checklist, no editing controls). Branching here
  // (not just hiding sections client-side) means that dashboard's data is
  // never sent to this viewer in the first place.
  if (viewerRole === "warranty") {
    const supabase = createClient();
    const { data: requests, error: requestsError } = await supabase
      .from("warranty_item_requests")
      .select(REQUEST_COLUMNS)
      .eq("project_id", params.id)
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
      // Every report on this construction, not just this account's own
      // uploads — same shared-visibility reasoning as requests above.
      supabase
        .from("inspection_reports")
        .select("id, project_id, checklist_item_id, warranty_item_request_id, file_name, storage_url, created_at")
        .eq("project_id", params.id),
    ]);

    // Resolved by whatever subcontractor_id is actually assigned to any
    // request on this construction — not by project_subcontractors links —
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
      <div className="mx-auto max-w-lg">
        <WarrantyHomeownerTabs
          createTab={<CreateWarrantyRequestForm projectId={params.id} />}
          trackTab={
            <>
              {(requestsError || commentsError) && (
                <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
                  Could not load warranty requests: {(requestsError ?? commentsError)?.message}
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
            </>
          }
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
      supabase.from("warranty_item_requests").select(REQUEST_COLUMNS).eq("project_id", params.id).order("created_at", { ascending: false }),
    ]);

  const requestIds = (requests ?? []).map((r) => r.id);
  // Any subcontractor in the shared directory can be assigned to a
  // warranty request, not just ones already linked to this specific
  // project (subcontractors_select's RLS already lets any signed-in user
  // read the whole directory) — a Contractor/Developer/PM fixing a
  // warranty item may want to bring in a sub who hasn't worked this
  // construction before.
  const [{ data: comments, error: commentsError }, { data: subcontractors }, { data: warrantyMemberRows }] = await Promise.all([
    requestIds.length > 0
      ? supabase
          .from("warranty_item_request_comments")
          .select("id, request_id, user_id, sender_email, sender_name, body, created_at")
          .in("request_id", requestIds)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    supabase.from("subcontractors").select("id, company_name, contact_name, trade, phone, email").order("company_name"),
    // project_members_select's RLS (has_project_access) already scopes this
    // to a project the viewer actually belongs to.
    supabase.from("project_members").select("user_id").eq("project_id", params.id).eq("role", "warranty"),
  ]);

  // profiles_select only lets a user read their own row, so the warranty
  // members' email/display name (for the "File on behalf of" picker) can't
  // be resolved via the caller's own session — the admin client bypasses
  // that, scoped here to exactly the ids project_members_select already
  // confirmed belong to this project.
  const warrantyUserIds = (warrantyMemberRows ?? []).map((m) => m.user_id);
  const warrantyMembers: WarrantyMemberOption[] =
    warrantyUserIds.length > 0
      ? await createAdminClient()
          .from("profiles")
          .select("id, email, display_name")
          .in("id", warrantyUserIds)
          .then(({ data }) => (data ?? []).map((p) => ({ id: p.id, email: p.email, displayName: p.display_name })))
      : [];

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
        warrantyMembers={warrantyMembers}
        viewerRole={viewerRole}
        currentUserId={currentUser?.id ?? null}
      />
    </div>
  );
}
