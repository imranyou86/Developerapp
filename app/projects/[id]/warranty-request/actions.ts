"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/app/projects/actions";
import { recordProjectFile, removeProjectFile } from "@/lib/projectFiles";
import { notifyForAction } from "@/lib/alerts";
import { logActivity } from "@/lib/activityLog";
import type { WarrantyItemStatus, WarrantyRequestProgress } from "@/lib/types";
import { WARRANTY_REQUEST_CATEGORIES } from "@/lib/warrantyRequestCategories";

// Warranty requests are checklist_items/checklist_photos rows with
// phase = "warranty" — same shape (title/done/comment/photos) as the
// rough-in/finish QA checklist, just filed by the homeowner post-completion
// and rendered on their own tab instead of the Checklist tab's columns.

function revalidate(projectId: string) {
  revalidatePath(`/projects/${projectId}/warranty-request`);
}

type Guard = { ok: true; userId: string } | { ok: false; error: string };

// The 'warranty' role is view-only here: it can watch checklist items,
// notes, and photos, and chat about them, but every mutation below is
// blocked for it — adding a new item goes through requestWarrantyItem's
// approval queue instead. Checked against the real stored profiles.role
// (not a Developer's preview role — see getCurrentUser), same as
// app/admin/actions.ts's requireDeveloper, since this is the actual
// authorization boundary, not a preview-mode convenience.
async function requireCanManageWarrantyItems(): Promise<Guard> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role === "warranty") {
    return { ok: false, error: "Warranty accounts can request an item but can't edit it directly — ask a Contractor or Developer." };
  }
  return { ok: true, userId: user.id };
}

const REQUEST_MANAGER_ROLES = ["contractor", "developer", "pm"];
const REQUEST_DELETE_ROLES = ["contractor", "developer"];

// Contractor, Developer, or PM can approve/reject a filed request, move its
// progress, assign a subcontractor, or comment on it — same boundary is
// also enforced in RLS (see warranty_item_requests_update and
// warranty_item_request_comments_insert in
// supabase/migrations/045_warranty_request_tracking.sql) for defense in
// depth, since these are real authorization boundaries, not just UI.
async function requireApprover(): Promise<Guard> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (!profile || !REQUEST_MANAGER_ROLES.includes(profile.role)) {
    return { ok: false, error: "Only a Contractor, Developer, or PM can manage a warranty request." };
  }
  return { ok: true, userId: user.id };
}

// Only Contractor/Developer can delete a request outright (not PM) — a
// stronger action than reject, which just flips status and keeps the row
// for the record. Same boundary enforced in RLS too (see
// warranty_item_requests_delete in migration 049).
async function requireCanDeleteRequest(): Promise<Guard> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (!profile || !REQUEST_DELETE_ROLES.includes(profile.role)) {
    return { ok: false, error: "Only a Contractor or Developer can delete a warranty request." };
  }
  return { ok: true, userId: user.id };
}

export async function addWarrantyItem(projectId: string, title: string): Promise<ActionResult> {
  const guard = await requireCanManageWarrantyItems();
  if (!guard.ok) return { ok: false, error: guard.error };

  const supabase = createClient();
  if (!title.trim()) return { ok: false, error: "Description is required." };

  const { count } = await supabase
    .from("checklist_items")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("phase", "warranty");

  const { error, data } = await supabase
    .from("checklist_items")
    .insert({ project_id: projectId, phase: "warranty", title: title.trim(), sort_order: count ?? 0 })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  await notifyForAction(projectId, "warranty_item_added", {
    subject: "New warranty request",
    body: `A new warranty item was filed: "${title.trim()}"`,
    excludeUserId: user?.id,
  });

  revalidate(projectId);
  return { ok: true, id: data.id };
}

export async function toggleWarrantyItem(
  projectId: string,
  itemId: string,
  done: boolean,
  itemTitle?: string
): Promise<ActionResult> {
  const guard = await requireCanManageWarrantyItems();
  if (!guard.ok) return { ok: false, error: guard.error };

  const supabase = createClient();
  const { error } = await supabase.from("checklist_items").update({ done }).eq("id", itemId);
  if (error) return { ok: false, error: error.message };

  if (done) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await notifyForAction(projectId, "warranty_item_done", {
      subject: "Warranty item fixed",
      body: `"${itemTitle ?? "A warranty item"}" was marked fixed.`,
      excludeUserId: user?.id,
    });
  }

  revalidate(projectId);
  return { ok: true };
}

export async function toggleWarrantyItems(projectId: string, itemIds: string[], done: boolean): Promise<ActionResult> {
  const guard = await requireCanManageWarrantyItems();
  if (!guard.ok) return { ok: false, error: guard.error };

  const supabase = createClient();
  const { error } = await supabase.from("checklist_items").update({ done }).in("id", itemIds);
  if (error) return { ok: false, error: error.message };

  if (done) {
    await notifyForAction(projectId, "warranty_item_done", {
      subject: "Warranty items fixed",
      body: `${itemIds.length} warranty item${itemIds.length === 1 ? " was" : "s were"} marked fixed.`,
      excludeUserId: guard.userId,
    });
  }

  revalidate(projectId);
  return { ok: true };
}

export async function setWarrantyStatus(
  projectId: string,
  itemId: string,
  status: WarrantyItemStatus,
  itemTitle?: string
): Promise<ActionResult> {
  const guard = await requireCanManageWarrantyItems();
  if (!guard.ok) return { ok: false, error: guard.error };

  const supabase = createClient();
  const { error } = await supabase.from("checklist_items").update({ status }).eq("id", itemId);
  if (error) return { ok: false, error: error.message };

  if (status !== "pending") {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const label = status === "validated" ? "validated" : "marked not covered by warranty";
    await notifyForAction(projectId, "warranty_item_status_changed", {
      subject: "Warranty item status changed",
      body: `"${itemTitle ?? "A warranty item"}" was ${label}.`,
      excludeUserId: user?.id,
    });
  }

  revalidate(projectId);
  return { ok: true };
}

export async function updateWarrantyComment(projectId: string, itemId: string, comment: string): Promise<ActionResult> {
  const guard = await requireCanManageWarrantyItems();
  if (!guard.ok) return { ok: false, error: guard.error };

  const supabase = createClient();
  const { error } = await supabase.from("checklist_items").update({ comment: comment || null }).eq("id", itemId);
  if (error) return { ok: false, error: error.message };
  revalidate(projectId);
  return { ok: true };
}

export async function deleteWarrantyItem(projectId: string, itemId: string, itemTitle?: string): Promise<ActionResult> {
  const guard = await requireCanManageWarrantyItems();
  if (!guard.ok) return { ok: false, error: guard.error };

  const supabase = createClient();
  const { error } = await supabase.from("checklist_items").delete().eq("id", itemId);
  if (error) return { ok: false, error: error.message };

  await logActivity(supabase, {
    projectId,
    userId: guard.userId,
    action: "warranty_item.deleted",
    entityType: "checklist_items",
    entityId: itemId,
    detail: itemTitle ? `Deleted warranty item "${itemTitle}"` : "Deleted a warranty item",
  });

  revalidate(projectId);
  return { ok: true };
}

export async function deleteWarrantyItems(
  projectId: string,
  itemIds: string[]
): Promise<ActionResult & { deletedIds?: string[] }> {
  const guard = await requireCanManageWarrantyItems();
  if (!guard.ok) return { ok: false, error: guard.error };

  const supabase = createClient();
  const { data, error } = await supabase.from("checklist_items").delete().in("id", itemIds).select("id");
  if (error) return { ok: false, error: error.message };

  await logActivity(supabase, {
    projectId,
    userId: guard.userId,
    action: "warranty_item.deleted",
    entityType: "checklist_items",
    detail: `Deleted ${itemIds.length} warranty item${itemIds.length === 1 ? "" : "s"}`,
  });

  revalidate(projectId);
  return { ok: true, deletedIds: (data ?? []).map((d) => d.id) };
}

export async function addWarrantyPhoto(
  projectId: string,
  itemId: string,
  storageUrl: string,
  itemTitle?: string
): Promise<ActionResult> {
  const guard = await requireCanManageWarrantyItems();
  if (!guard.ok) return { ok: false, error: guard.error };

  const supabase = createClient();
  const { error, data } = await supabase
    .from("checklist_photos")
    .insert({ checklist_item_id: itemId, storage_url: storageUrl })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  await recordProjectFile(supabase, {
    projectId,
    storageUrl,
    fileName: itemTitle ? `${itemTitle} photo` : "Warranty request photo",
    category: "checklist_photo",
    sourceTable: "checklist_photos",
    sourceId: data.id,
  });

  revalidate(projectId);
  return { ok: true, id: data.id };
}

export async function deleteWarrantyPhoto(projectId: string, photoId: string): Promise<ActionResult> {
  const guard = await requireCanManageWarrantyItems();
  if (!guard.ok) return { ok: false, error: guard.error };

  const supabase = createClient();
  const { error } = await supabase.from("checklist_photos").delete().eq("id", photoId);
  if (error) return { ok: false, error: error.message };
  await removeProjectFile(supabase, "checklist_photos", photoId);
  revalidate(projectId);
  return { ok: true };
}

// Inspection reports are uploaded once (any file type — PDF, photos, scans)
// and can then be attached to a specific warranty item, same idea as
// checklist photos but decoupled: a report can exist unattached, and
// attachInspectionReport can move it between items or detach it later
// rather than being fixed to the item it was uploaded under.
//
// Any signed-in user with access to the project can upload one — a
// 'warranty' account included, whether it's an inspection report they
// received themselves (unattached, read for AI extraction — see
// requestWarrantyItems) or evidence attached to a request they filed. No
// extra application-level gate beyond that: inspection_reports_member's RLS
// (has_project_access) is the real authorization boundary here, same as
// every other read/write on this table.
export async function addInspectionReport(
  projectId: string,
  fileName: string,
  storageUrl: string,
  warrantyItemRequestId?: string
): Promise<ActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error, data } = await supabase
    .from("inspection_reports")
    .insert({
      project_id: projectId,
      file_name: fileName,
      storage_url: storageUrl,
      created_by: user.id,
      warranty_item_request_id: warrantyItemRequestId ?? null,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  await recordProjectFile(supabase, {
    projectId,
    storageUrl,
    fileName,
    category: "document",
    sourceTable: "inspection_reports",
    sourceId: data.id,
  });

  revalidate(projectId);
  return { ok: true, id: data.id };
}

export async function attachInspectionReport(
  projectId: string,
  reportId: string,
  checklistItemId: string | null
): Promise<ActionResult> {
  const guard = await requireCanManageWarrantyItems();
  if (!guard.ok) return { ok: false, error: guard.error };

  const supabase = createClient();
  const { error } = await supabase.from("inspection_reports").update({ checklist_item_id: checklistItemId }).eq("id", reportId);
  if (error) return { ok: false, error: error.message };
  revalidate(projectId);
  return { ok: true };
}

export async function deleteInspectionReport(projectId: string, reportId: string): Promise<ActionResult> {
  const guard = await requireCanManageWarrantyItems();
  if (!guard.ok) return { ok: false, error: guard.error };

  const supabase = createClient();
  const { error } = await supabase.from("inspection_reports").delete().eq("id", reportId);
  if (error) return { ok: false, error: error.message };
  await removeProjectFile(supabase, "inspection_reports", reportId);

  await logActivity(supabase, {
    projectId,
    userId: guard.userId,
    action: "inspection_report.deleted",
    entityType: "inspection_reports",
    entityId: reportId,
  });

  revalidate(projectId);
  return { ok: true };
}

export interface WarrantyFinding {
  title: string;
  detail: string | null;
}

export interface CreatedWarrantyItem {
  id: string;
  title: string;
  comment: string | null;
}

// Bulk-creates warranty checklist items from a report's AI-extracted
// findings (app/api/claude/extract-inspection-report) — one insert instead
// of one addWarrantyItem call per finding, and sort_order is computed once
// against the count at call time rather than racing per-item.
export async function addWarrantyItemsFromReport(
  projectId: string,
  findings: WarrantyFinding[]
): Promise<ActionResult & { items?: CreatedWarrantyItem[] }> {
  const guard = await requireCanManageWarrantyItems();
  if (!guard.ok) return { ok: false, error: guard.error };

  const usable = findings.filter((f) => f.title.trim());
  if (usable.length === 0) return { ok: false, error: "No findings to add." };

  const supabase = createClient();
  const { count } = await supabase
    .from("checklist_items")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("phase", "warranty");

  const rows = usable.map((f, i) => ({
    project_id: projectId,
    phase: "warranty" as const,
    title: f.title.trim(),
    comment: f.detail?.trim() || null,
    sort_order: (count ?? 0) + i,
  }));

  const { error, data } = await supabase.from("checklist_items").insert(rows).select("id, title, comment");
  if (error) return { ok: false, error: error.message };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  await notifyForAction(projectId, "warranty_items_from_report", {
    subject: "New warranty requests from an inspection report",
    body: `${data.length} new warranty item${data.length === 1 ? "" : "s"} added:\n${data.map((it) => `- ${it.title}`).join("\n")}`,
    excludeUserId: user?.id,
  });

  revalidate(projectId);
  return { ok: true, items: data };
}

export interface WarrantyRequestInput {
  title: string;
  comment?: string | null;
  category?: string | null;
}

// Resolves who a batch of requests should be filed as: normally the caller
// themselves (a 'warranty' account filing its own request — blocked from
// calling addWarrantyItem directly by requireCanManageWarrantyItems, so it
// comes through here instead), or, when onBehalfOfUserId is given, a
// specific homeowner a Contractor/Developer/PM is filing for because that
// account doesn't know how to use the form itself. The RLS insert policy
// (migration 057) allows either shape; this also verifies the target is an
// actual 'warranty' member of this project, so a manager can't accidentally
// (or otherwise) attribute a request to an unrelated account.
async function resolveRequester(
  projectId: string,
  onBehalfOfUserId?: string
): Promise<{ ok: true; requestedBy: string; actingUserId: string } | { ok: false; error: string }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  if (!onBehalfOfUserId) return { ok: true, requestedBy: user.id, actingUserId: user.id };

  const guard = await requireApprover();
  if (!guard.ok) return { ok: false, error: "Only a Contractor, Developer, or PM can file a request on behalf of someone else." };

  const { data: member } = await supabase
    .from("project_members")
    .select("id")
    .eq("project_id", projectId)
    .eq("user_id", onBehalfOfUserId)
    .eq("role", "warranty")
    .maybeSingle();
  if (!member) return { ok: false, error: "That account isn't a warranty member of this construction." };

  return { ok: true, requestedBy: onBehalfOfUserId, actingUserId: guard.userId };
}

// A 'warranty' user files here instead of calling addWarrantyItem directly
// (requireCanManageWarrantyItems blocks that role from it) — a Contractor
// or Developer then reviews the queue and approves or rejects it below.
export async function requestWarrantyItem(
  projectId: string,
  title: string,
  comment?: string,
  category?: string | null,
  onBehalfOfUserId?: string
): Promise<ActionResult> {
  const res = await requestWarrantyItems(projectId, [{ title, comment, category }], onBehalfOfUserId);
  if (!res.ok || !res.ids?.[0]) return { ok: false, error: res.error };
  return { ok: true, id: res.ids[0] };
}

function normalizeCategory(category?: string | null): string | null {
  return category && (WARRANTY_REQUEST_CATEGORIES as readonly string[]).includes(category) ? category : null;
}

// Bulk version — one call, covered by one notification instead of N. Used
// for: AI extraction from an uploaded inspection report (each finding
// already carries its own trade classification, which may span several
// trades in one report), and a manually-typed batch of tasks filed under
// one shared trade category ("list everything electrical needs" without a
// report to extract from).
//
// Items sharing a category are bucketed together: 2+ items in the same
// bucket become one "group" request (is_group=true) — a single ticket for
// that trade, with its own subcontractor/schedule shared by every task
// inside it, since in practice one subcontractor visit covers all of them
// and there's no reason to track N separate tickets for it — with a
// child task row per item, each independently approved/rejected. A bucket
// with exactly one item is just an ordinary standalone request, same as
// filing a single issue has always worked.
export async function requestWarrantyItems(
  projectId: string,
  items: WarrantyRequestInput[],
  onBehalfOfUserId?: string
): Promise<ActionResult & { ids?: string[] }> {
  const usable = items.filter((i) => i.title.trim());
  if (usable.length === 0) return { ok: false, error: "At least one description is required." };

  const requester = await resolveRequester(projectId, onBehalfOfUserId);
  if (!requester.ok) return { ok: false, error: requester.error };

  const supabase = createClient();

  const buckets = new Map<string, WarrantyRequestInput[]>();
  for (const item of usable) {
    const key = normalizeCategory(item.category) ?? "";
    const list = buckets.get(key) ?? [];
    list.push(item);
    buckets.set(key, list);
  }

  const allRows: { id: string; title: string; category: string | null; is_group: boolean }[] = [];
  const insertRows: Record<string, unknown>[] = [];

  // Every object pushed to insertRows carries the exact same set of keys
  // (comment/is_group/group_id explicitly null where not applicable) even
  // though the three row shapes below don't all need every column — a
  // single .insert() call with a batch of objects becomes one INSERT
  // statement whose column list PostgREST derives from the union of keys
  // across the whole array; any row missing a key gets an explicit NULL for
  // that column rather than falling back to the table's default, which
  // trips the "is_group" not-null constraint the moment a batch mixes a
  // standalone row (no is_group key at all) with a group/task row that has
  // one.
  for (const [key, bucketItems] of buckets) {
    const category = key || null;
    if (bucketItems.length === 1) {
      const id = crypto.randomUUID();
      insertRows.push({
        id,
        project_id: projectId,
        title: bucketItems[0].title.trim(),
        comment: bucketItems[0].comment?.trim() || null,
        category,
        requested_by: requester.requestedBy,
        is_group: false,
        group_id: null,
      });
      allRows.push({ id, title: bucketItems[0].title.trim(), category, is_group: false });
    } else {
      const groupId = crypto.randomUUID();
      insertRows.push({
        id: groupId,
        project_id: projectId,
        title: category ?? "Warranty items",
        comment: null,
        category,
        requested_by: requester.requestedBy,
        is_group: true,
        group_id: null,
      });
      allRows.push({ id: groupId, title: category ?? "Warranty items", category, is_group: true });
      for (const item of bucketItems) {
        const taskId = crypto.randomUUID();
        insertRows.push({
          id: taskId,
          project_id: projectId,
          title: item.title.trim(),
          comment: item.comment?.trim() || null,
          category,
          requested_by: requester.requestedBy,
          is_group: false,
          group_id: groupId,
        });
        allRows.push({ id: taskId, title: item.title.trim(), category, is_group: false });
      }
    }
  }

  // Bare insert with no .select() — same reasoning as the old single-row
  // insert had (see migration 048): an INSERT ... RETURNING also has to
  // pass the table's SELECT policy, a separate check from the INSERT
  // policy's own WITH CHECK, and that's an extra way for this to be
  // rejected for no reason when filing on behalf of someone else (the
  // caller can insert as that user but can't necessarily read their rows
  // back through can_view_warranty_request). ids are generated client-side
  // above instead.
  const { error } = await supabase.from("warranty_item_requests").insert(insertRows);
  if (error) return { ok: false, error: error.message };

  const taskCount = allRows.filter((r) => !r.is_group).length;
  const categories = Array.from(new Set(allRows.map((r) => r.category).filter((c): c is string => !!c)));
  const summary =
    taskCount === 1
      ? `A warranty item was requested${allRows[0].category ? ` (${allRows[0].category})` : ""}: "${allRows.find((r) => !r.is_group)!.title}" — awaiting your approval.`
      : `${taskCount} warranty items were requested${categories.length ? ` (${categories.join(", ")})` : ""} — awaiting your approval.`;

  // Roles force-notified for "warranty_request_submitted" default to
  // contractor/developer (Admin-configurable — see
  // lib/notificationCatalog.ts) regardless of whether they've opted into
  // "Get alerts" — a new request needing review isn't optional the way a
  // general project update is. excludeUserId is whoever actually filed it
  // (the manager, when filing on behalf of someone else) so they don't get
  // notified about their own submission.
  await notifyForAction(projectId, "warranty_request_submitted", {
    subject: taskCount === 1 ? "New warranty item request" : "New warranty item requests",
    body: summary,
    excludeUserId: requester.actingUserId,
  });

  revalidate(projectId);
  return { ok: true, ids: allRows.map((r) => r.id) };
}

// Approving copies the request into a real checklist_items row (same shape
// addWarrantyItem creates) and links back via checklist_item_id, so the
// approved item then shows up in the normal list above the queue.
export async function approveWarrantyItemRequest(projectId: string, requestId: string): Promise<ActionResult> {
  const guard = await requireApprover();
  if (!guard.ok) return { ok: false, error: guard.error };

  const supabase = createClient();
  const { data: request, error: fetchError } = await supabase
    .from("warranty_item_requests")
    .select("id, title, comment, status")
    .eq("id", requestId)
    .single();
  if (fetchError) return { ok: false, error: fetchError.message };
  if (request.status !== "pending") return { ok: false, error: "This request has already been reviewed." };

  const { count } = await supabase
    .from("checklist_items")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("phase", "warranty");

  const { error: insertError, data: item } = await supabase
    .from("checklist_items")
    .insert({ project_id: projectId, phase: "warranty", title: request.title, comment: request.comment, sort_order: count ?? 0 })
    .select("id")
    .single();
  if (insertError) return { ok: false, error: insertError.message };

  const { error: updateError } = await supabase
    .from("warranty_item_requests")
    .update({ status: "approved", checklist_item_id: item.id, reviewed_by: guard.userId, reviewed_at: new Date().toISOString() })
    .eq("id", requestId);
  if (updateError) return { ok: false, error: updateError.message };

  await logActivity(supabase, {
    projectId,
    userId: guard.userId,
    action: "warranty_item_request.approved",
    entityType: "warranty_item_requests",
    entityId: requestId,
    detail: `Approved "${request.title}"`,
  });

  await notifyForAction(projectId, "warranty_request_approved", {
    subject: "Warranty request approved",
    body: `"${request.title}" was approved and added to the warranty list.`,
    excludeUserId: guard.userId,
  });

  revalidate(projectId);
  return { ok: true, id: item.id };
}

export async function rejectWarrantyItemRequest(projectId: string, requestId: string, note?: string): Promise<ActionResult> {
  const guard = await requireApprover();
  if (!guard.ok) return { ok: false, error: guard.error };

  const supabase = createClient();
  const { data: request, error: fetchError } = await supabase
    .from("warranty_item_requests")
    .select("title, status")
    .eq("id", requestId)
    .single();
  if (fetchError) return { ok: false, error: fetchError.message };
  if (request.status !== "pending") return { ok: false, error: "This request has already been reviewed." };

  const trimmedNote = note?.trim() || null;
  const { error } = await supabase
    .from("warranty_item_requests")
    .update({ status: "rejected", rejection_note: trimmedNote, reviewed_by: guard.userId, reviewed_at: new Date().toISOString() })
    .eq("id", requestId);
  if (error) return { ok: false, error: error.message };

  await logActivity(supabase, {
    projectId,
    userId: guard.userId,
    action: "warranty_item_request.rejected",
    entityType: "warranty_item_requests",
    entityId: requestId,
    detail: trimmedNote ? `Rejected "${request.title}": ${trimmedNote}` : `Rejected "${request.title}"`,
  });

  await notifyForAction(projectId, "warranty_request_rejected", {
    subject: "Warranty request rejected",
    body: trimmedNote
      ? `"${request.title}" was not approved as a warranty item: ${trimmedNote}`
      : `"${request.title}" was not approved as a warranty item.`,
    excludeUserId: guard.userId,
  });

  revalidate(projectId);
  return { ok: true };
}

// Lets a Contractor/Developer/PM fix a miscategorized request (or add a
// category one never had) — the trade grouping on both dashboards
// (RequestsSection, MyWarrantyRequests) is computed straight from this
// column, so reassigning it moves the request into the right group
// immediately. null clears it back to "Uncategorized".
export async function updateWarrantyRequestCategory(
  projectId: string,
  requestId: string,
  category: string | null
): Promise<ActionResult> {
  const guard = await requireApprover();
  if (!guard.ok) return { ok: false, error: guard.error };
  if (category && !(WARRANTY_REQUEST_CATEGORIES as readonly string[]).includes(category)) {
    return { ok: false, error: "Not a recognized category." };
  }

  const supabase = createClient();
  const { error } = await supabase.from("warranty_item_requests").update({ category }).eq("id", requestId);
  if (error) return { ok: false, error: error.message };
  revalidate(projectId);
  return { ok: true };
}

// Removes the request row outright — unlike reject, which just flips
// status and keeps it for the record. checklist_item_id isn't touched:
// deleting a request that was already approved leaves the real
// checklist_items row (and any work already tracked against it) in place;
// this only removes the request/ticket itself. Attached inspection
// reports fall back to unattached rather than being deleted, same as
// detaching one manually (warranty_item_request_id ... on delete set
// null). Comments cascade-delete with the request.
export async function deleteWarrantyItemRequest(projectId: string, requestId: string): Promise<ActionResult> {
  const guard = await requireCanDeleteRequest();
  if (!guard.ok) return { ok: false, error: guard.error };

  const supabase = createClient();
  const { data: request, error: fetchError } = await supabase
    .from("warranty_item_requests")
    .select("title")
    .eq("id", requestId)
    .maybeSingle();
  if (fetchError) return { ok: false, error: fetchError.message };
  if (!request) return { ok: false, error: "This request no longer exists." };

  const { error } = await supabase.from("warranty_item_requests").delete().eq("id", requestId);
  if (error) return { ok: false, error: error.message };

  await logActivity(supabase, {
    projectId,
    userId: guard.userId,
    action: "warranty_item_request.deleted",
    entityType: "warranty_item_requests",
    entityId: requestId,
    detail: `Deleted "${request.title}"`,
  });

  revalidate(projectId);
  return { ok: true };
}

// Independent of status (pending/approved/rejected) above — this is
// Contractor/Developer/PM tracking the actual work through to done, and
// can move whether or not the request has been formally approved yet.
export async function setWarrantyRequestProgress(
  projectId: string,
  requestId: string,
  progress: WarrantyRequestProgress,
  requestTitle?: string
): Promise<ActionResult> {
  const guard = await requireApprover();
  if (!guard.ok) return { ok: false, error: guard.error };

  const supabase = createClient();
  const { error } = await supabase.from("warranty_item_requests").update({ progress }).eq("id", requestId);
  if (error) return { ok: false, error: error.message };

  const label = progress === "in_progress" ? "in progress" : progress === "complete" ? "complete" : "open";
  await notifyForAction(projectId, "warranty_request_status_changed", {
    subject: "Warranty request status changed",
    body: `"${requestTitle ?? "A warranty request"}" is now ${label}.`,
    excludeUserId: guard.userId,
  });

  revalidate(projectId);
  return { ok: true };
}

export async function assignWarrantyRequestSubcontractor(
  projectId: string,
  requestId: string,
  subcontractorId: string | null
): Promise<ActionResult> {
  const guard = await requireApprover();
  if (!guard.ok) return { ok: false, error: guard.error };

  const supabase = createClient();
  const { error } = await supabase.from("warranty_item_requests").update({ subcontractor_id: subcontractorId }).eq("id", requestId);
  if (error) return { ok: false, error: error.message };
  revalidate(projectId);
  return { ok: true };
}

// Sets when the assigned subcontractor is expected to show up — surfaced on
// /calendar (see app/calendar/page.tsx) and shown to the homeowner who
// filed the request (WarrantyRequestCard's read-only view). Unlike every
// other notify call in this file (which just goes to whoever's subscribed
// or force-notified by role), this one always reaches the person who filed
// the request — they need to know a visit is coming whether or not they
// personally clicked "Get alerts."
export async function setWarrantyRequestSchedule(
  projectId: string,
  requestId: string,
  schedule: { date: string | null; timeStart: string | null; timeEnd: string | null },
  requestTitle?: string
): Promise<ActionResult> {
  const guard = await requireApprover();
  if (!guard.ok) return { ok: false, error: guard.error };

  const supabase = createClient();
  const { data: request, error: fetchError } = await supabase
    .from("warranty_item_requests")
    .select("requested_by")
    .eq("id", requestId)
    .maybeSingle();
  if (fetchError) return { ok: false, error: fetchError.message };

  const { error } = await supabase
    .from("warranty_item_requests")
    .update({
      scheduled_date: schedule.date,
      scheduled_time_start: schedule.timeStart,
      scheduled_time_end: schedule.timeEnd,
    })
    .eq("id", requestId);
  if (error) return { ok: false, error: error.message };

  if (schedule.date && request?.requested_by) {
    const window = schedule.timeStart
      ? ` (${schedule.timeStart}${schedule.timeEnd ? `–${schedule.timeEnd}` : ""})`
      : "";
    await notifyForAction(projectId, "warranty_request_scheduled", {
      subject: "Warranty visit scheduled",
      body: `A visit for "${requestTitle ?? "your warranty request"}" is scheduled for ${schedule.date}${window}.`,
      excludeUserId: guard.userId,
      alwaysIncludeUserId: request.requested_by,
    });
  }

  revalidate(projectId);
  return { ok: true };
}

// Comments/notes on a request — Contractor/Developer/PM can post (enforced
// in RLS too, see warranty_item_request_comments_insert); a 'warranty'
// account can only read them, for any request on a construction it's
// assigned to (per can_view_warranty_request — see migration 058).
export async function addWarrantyRequestComment(
  projectId: string,
  requestId: string,
  body: string
): Promise<ActionResult & { createdAt?: string }> {
  const guard = await requireApprover();
  if (!guard.ok) return { ok: false, error: guard.error };
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, error: "Comment can't be empty." };

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // profiles_select only lets a user read their own row, so this looks up
  // the sender's own display name to denormalize onto the comment the same
  // way sender_email already is — see migration 050_user_display_names.sql.
  const { data: profile } = await supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle();
  const senderName = profile?.display_name || null;

  const { error, data } = await supabase
    .from("warranty_item_request_comments")
    .insert({
      request_id: requestId,
      user_id: user.id,
      sender_email: user.email ?? "unknown",
      sender_name: senderName,
      body: trimmed,
    })
    .select("id, created_at")
    .single();
  if (error) return { ok: false, error: error.message };

  await notifyForAction(projectId, "warranty_request_comment", {
    subject: "New comment on a warranty request",
    body: `${senderName ?? user.email ?? "Someone"} commented:\n\n${trimmed}`,
    excludeUserId: user.id,
  });

  revalidate(projectId);
  return { ok: true, id: data.id, createdAt: data.created_at };
}

export async function deleteWarrantyRequestComment(projectId: string, commentId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("warranty_item_request_comments").delete().eq("id", commentId);
  if (error) return { ok: false, error: error.message };
  revalidate(projectId);
  return { ok: true };
}
