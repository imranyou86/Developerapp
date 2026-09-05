"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/app/projects/actions";
import { recordProjectFile, removeProjectFile } from "@/lib/projectFiles";

export async function addPlanPage(
  projectId: string,
  storageUrl: string,
  label: string,
  sortOrder: number
): Promise<ActionResult> {
  const supabase = createClient();
  const { error, data } = await supabase
    .from("plan_pages")
    .insert({ project_id: projectId, storage_url: storageUrl, label, sort_order: sortOrder })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  await recordProjectFile(supabase, {
    projectId,
    storageUrl,
    fileName: label,
    category: "plan",
    sourceTable: "plan_pages",
    sourceId: data.id,
  });

  revalidatePath(`/projects/${projectId}/plan`);
  return { ok: true, id: data.id };
}

export async function setPlanPageLayout(projectId: string, pageId: string, isLayout: boolean): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("plan_pages").update({ is_layout: isLayout }).eq("id", pageId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/projects/${projectId}/plan`);
  return { ok: true };
}

export async function deletePlanPage(projectId: string, pageId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("plan_pages").delete().eq("id", pageId);
  if (error) return { ok: false, error: error.message };
  await removeProjectFile(supabase, "plan_pages", pageId);
  revalidatePath(`/projects/${projectId}/plan`);
  return { ok: true };
}

// "Validate" on the Plan tab — once the real floor plan sheets are checked
// (elevations/sections/cover sheets unchecked), this removes everything
// NOT checked, so the plan list only holds the actual layout pages that
// room detection/Construction Cost/House Book read from.
export async function deleteNonLayoutPages(projectId: string): Promise<ActionResult & { deletedCount?: number }> {
  const supabase = createClient();
  const { data: toDelete, error: fetchError } = await supabase
    .from("plan_pages")
    .select("id")
    .eq("project_id", projectId)
    .eq("is_layout", false);
  if (fetchError) return { ok: false, error: fetchError.message };
  if (!toDelete || toDelete.length === 0) return { ok: true, deletedCount: 0 };

  const ids = toDelete.map((p) => p.id);
  const { error } = await supabase.from("plan_pages").delete().in("id", ids);
  if (error) return { ok: false, error: error.message };

  await Promise.all(ids.map((id) => removeProjectFile(supabase, "plan_pages", id)));

  revalidatePath(`/projects/${projectId}/plan`);
  return { ok: true, deletedCount: ids.length };
}

export interface DetectedRoomInput {
  name: string;
  type: string | null;
  floor: number | null;
  width: number | null;
  depth: number | null;
  estimated: boolean;
}

export async function addDetectedRooms(
  projectId: string,
  rooms: DetectedRoomInput[]
): Promise<ActionResult> {
  const supabase = createClient();
  if (rooms.length === 0) return { ok: true };

  const { error } = await supabase.from("rooms").insert(
    rooms.map((r) => ({
      project_id: projectId,
      name: r.name,
      type: r.type,
      floor: r.floor,
      width: r.width,
      depth: r.depth,
      estimated: r.estimated,
    }))
  );

  if (error) return { ok: false, error: error.message };
  revalidatePath(`/projects/${projectId}/rooms`);
  revalidatePath(`/projects/${projectId}/plan`);
  return { ok: true };
}
