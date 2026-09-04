"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/app/projects/actions";
import type { ChecklistPhase } from "@/lib/types";
import { CHECKLIST_SEED } from "@/lib/checklist-seed";
import { recordProjectFile, removeProjectFile } from "@/lib/projectFiles";

function revalidate(projectId: string) {
  revalidatePath(`/projects/${projectId}/checklist`);
}

export async function ensureChecklistSeeded(projectId: string): Promise<void> {
  const supabase = createClient();
  const { count } = await supabase
    .from("checklist_items")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);

  if (!count) {
    const seedRows = CHECKLIST_SEED.map((item, i) => ({
      project_id: projectId,
      phase: item.phase,
      title: item.title,
      sort_order: i,
    }));
    await supabase.from("checklist_items").insert(seedRows);
  }
}

export async function toggleChecklistItem(projectId: string, itemId: string, done: boolean): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("checklist_items").update({ done }).eq("id", itemId);
  if (error) return { ok: false, error: error.message };
  revalidate(projectId);
  return { ok: true };
}

export async function updateChecklistComment(
  projectId: string,
  itemId: string,
  comment: string
): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("checklist_items").update({ comment: comment || null }).eq("id", itemId);
  if (error) return { ok: false, error: error.message };
  revalidate(projectId);
  return { ok: true };
}

export async function addChecklistItem(
  projectId: string,
  phase: ChecklistPhase,
  title: string
): Promise<ActionResult> {
  const supabase = createClient();
  if (!title.trim()) return { ok: false, error: "Title is required." };

  const { count } = await supabase
    .from("checklist_items")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("phase", phase);

  const { error, data } = await supabase
    .from("checklist_items")
    .insert({ project_id: projectId, phase, title: title.trim(), sort_order: count ?? 0 })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidate(projectId);
  return { ok: true, id: data.id };
}

export async function deleteChecklistItem(projectId: string, itemId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("checklist_items").delete().eq("id", itemId);
  if (error) return { ok: false, error: error.message };
  revalidate(projectId);
  return { ok: true };
}

export async function addChecklistPhoto(
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
    fileName: itemTitle ? `${itemTitle} photo` : "Checklist photo",
    category: "checklist_photo",
    sourceTable: "checklist_photos",
    sourceId: data.id,
  });

  revalidate(projectId);
  return { ok: true, id: data.id };
}

export async function deleteChecklistPhoto(projectId: string, photoId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("checklist_photos").delete().eq("id", photoId);
  if (error) return { ok: false, error: error.message };
  await removeProjectFile(supabase, "checklist_photos", photoId);
  revalidate(projectId);
  return { ok: true };
}
