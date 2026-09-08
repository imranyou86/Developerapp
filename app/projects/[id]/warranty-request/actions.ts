"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/app/projects/actions";
import { recordProjectFile, removeProjectFile } from "@/lib/projectFiles";

// Warranty requests are checklist_items/checklist_photos rows with
// phase = "warranty" — same shape (title/done/comment/photos) as the
// rough-in/finish QA checklist, just filed by the homeowner post-completion
// and rendered on their own tab instead of the Checklist tab's columns.

function revalidate(projectId: string) {
  revalidatePath(`/projects/${projectId}/warranty-request`);
}

export async function addWarrantyItem(projectId: string, title: string): Promise<ActionResult> {
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
  revalidate(projectId);
  return { ok: true, id: data.id };
}

export async function toggleWarrantyItem(projectId: string, itemId: string, done: boolean): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("checklist_items").update({ done }).eq("id", itemId);
  if (error) return { ok: false, error: error.message };
  revalidate(projectId);
  return { ok: true };
}

export async function updateWarrantyComment(projectId: string, itemId: string, comment: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("checklist_items").update({ comment: comment || null }).eq("id", itemId);
  if (error) return { ok: false, error: error.message };
  revalidate(projectId);
  return { ok: true };
}

export async function deleteWarrantyItem(projectId: string, itemId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("checklist_items").delete().eq("id", itemId);
  if (error) return { ok: false, error: error.message };
  revalidate(projectId);
  return { ok: true };
}

export async function addWarrantyPhoto(
  projectId: string,
  itemId: string,
  storageUrl: string,
  itemTitle?: string
): Promise<ActionResult> {
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
export async function addInspectionReport(
  projectId: string,
  fileName: string,
  storageUrl: string
): Promise<ActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error, data } = await supabase
    .from("inspection_reports")
    .insert({ project_id: projectId, file_name: fileName, storage_url: storageUrl, created_by: user.id })
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
  const supabase = createClient();
  const { error } = await supabase.from("inspection_reports").update({ checklist_item_id: checklistItemId }).eq("id", reportId);
  if (error) return { ok: false, error: error.message };
  revalidate(projectId);
  return { ok: true };
}

export async function deleteInspectionReport(projectId: string, reportId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("inspection_reports").delete().eq("id", reportId);
  if (error) return { ok: false, error: error.message };
  await removeProjectFile(supabase, "inspection_reports", reportId);
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

  revalidate(projectId);
  return { ok: true, items: data };
}
