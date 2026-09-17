"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/app/projects/actions";
import { recordProjectFile, removeProjectFile } from "@/lib/projectFiles";
import { notifyProjectSubscribers } from "@/lib/alerts";
import { logActivity } from "@/lib/activityLog";
import type { WarrantyItemStatus, WarrantyRequestProgress } from "@/lib/types";

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
  await notifyProjectSubscribers(projectId, {
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
    await notifyProjectSubscribers(projectId, {
      subject: "Warranty item fixed",
      body: `"${itemTitle ?? "A warranty item"}" was marked fixed.`,
      excludeUserId: user?.id,
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
    await notifyProjectSubscribers(projectId, {
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
// A 'warranty' account is normally blocked by requireCanManageWarrantyItems
// (it can't touch checklist items directly), but it CAN attach evidence to
// its own filed request — a request has no checklist_item_id until it's
// approved, so this is the only way for the person who filed it to attach
// anything at all. warrantyItemRequestId, when passed, is checked against
// the caller: either they manage warranty items generally, or they filed
// that specific request themselves.
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

  const guard = await requireCanManageWarrantyItems();
  if (!guard.ok) {
    if (!warrantyItemRequestId) return { ok: false, error: guard.error };
    const { data: request } = await supabase
      .from("warranty_item_requests")
      .select("requested_by")
      .eq("id", warrantyItemRequestId)
      .maybeSingle();
    if (!request || request.requested_by !== user.id) {
      return { ok: false, error: "You can only attach a report to your own request." };
    }
  }

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
  await notifyProjectSubscribers(projectId, {
    subject: "New warranty requests from an inspection report",
    body: `${data.length} new warranty item${data.length === 1 ? "" : "s"} added:\n${data.map((it) => `- ${it.title}`).join("\n")}`,
    excludeUserId: user?.id,
  });

  revalidate(projectId);
  return { ok: true, items: data };
}

// A 'warranty' user files here instead of calling addWarrantyItem directly
// (requireCanManageWarrantyItems blocks that role from it) — a Contractor
// or Developer then reviews the queue and approves or rejects it below.
export async function requestWarrantyItem(
  projectId: string,
  title: string,
  comment?: string,
  category?: string | null
): Promise<ActionResult> {
  if (!title.trim()) return { ok: false, error: "Description is required." };

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error, data } = await supabase
    .from("warranty_item_requests")
    .insert({
      project_id: projectId,
      title: title.trim(),
      comment: comment?.trim() || null,
      category: category || null,
      requested_by: user.id,
    })
    .select("id")
    .single();
  if (error) {
    // Postgres's raw RLS-violation text ("new row violates row-level
    // security policy...") means this account isn't actually a member of
    // (or owner of) this specific construction — having the 'warranty'
    // role alone doesn't grant that; a Developer has to assign the account
    // to this construction from Admin's Users list first (the "Projects"
    // button there, or the "Projects & invites" section).
    if (error.code === "42501") {
      return { ok: false, error: "You don't have access to this construction yet — ask a Developer to add your account to it." };
    }
    return { ok: false, error: error.message };
  }

  await notifyProjectSubscribers(projectId, {
    subject: "New warranty item request",
    body: `A warranty item was requested${category ? ` (${category})` : ""}: "${title.trim()}" — awaiting Contractor/Developer/PM approval.`,
    excludeUserId: user.id,
  });

  revalidate(projectId);
  return { ok: true, id: data.id };
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

  await notifyProjectSubscribers(projectId, {
    subject: "Warranty request approved",
    body: `"${request.title}" was approved and added to the warranty list.`,
    excludeUserId: guard.userId,
  });

  revalidate(projectId);
  return { ok: true, id: item.id };
}

export async function rejectWarrantyItemRequest(projectId: string, requestId: string): Promise<ActionResult> {
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

  const { error } = await supabase
    .from("warranty_item_requests")
    .update({ status: "rejected", reviewed_by: guard.userId, reviewed_at: new Date().toISOString() })
    .eq("id", requestId);
  if (error) return { ok: false, error: error.message };

  await logActivity(supabase, {
    projectId,
    userId: guard.userId,
    action: "warranty_item_request.rejected",
    entityType: "warranty_item_requests",
    entityId: requestId,
    detail: `Rejected "${request.title}"`,
  });

  await notifyProjectSubscribers(projectId, {
    subject: "Warranty request rejected",
    body: `"${request.title}" was not approved as a warranty item.`,
    excludeUserId: guard.userId,
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
  await notifyProjectSubscribers(projectId, {
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

// Comments/notes on a request — Contractor/Developer/PM can post (enforced
// in RLS too, see warranty_item_request_comments_insert), the 'warranty'
// role who filed it can only read them (its own request only, per
// can_view_warranty_request).
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

  const { error, data } = await supabase
    .from("warranty_item_request_comments")
    .insert({ request_id: requestId, user_id: user.id, sender_email: user.email ?? "unknown", body: trimmed })
    .select("id, created_at")
    .single();
  if (error) return { ok: false, error: error.message };

  await notifyProjectSubscribers(projectId, {
    subject: "New comment on a warranty request",
    body: `${user.email ?? "Someone"} commented:\n\n${trimmed}`,
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
