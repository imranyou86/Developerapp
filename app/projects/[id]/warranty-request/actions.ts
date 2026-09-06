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
