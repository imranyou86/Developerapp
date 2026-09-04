"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/app/projects/actions";

export async function addPlanPage(
  projectId: string,
  storageUrl: string,
  label: string,
  sortOrder: number
): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase
    .from("plan_pages")
    .insert({ project_id: projectId, storage_url: storageUrl, label, sort_order: sortOrder });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/projects/${projectId}/plan`);
  return { ok: true };
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
  revalidatePath(`/projects/${projectId}/plan`);
  return { ok: true };
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
