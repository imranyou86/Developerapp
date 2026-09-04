"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/app/projects/actions";
import type { FinishCategory, StyleName } from "@/lib/types";
import { recordProjectFile, removeProjectFile } from "@/lib/projectFiles";

function revalidate(projectId: string) {
  revalidatePath(`/projects/${projectId}/rooms`);
  revalidatePath(`/projects/${projectId}/budget`);
  revalidatePath(`/projects`);
}

export async function addRoom(
  projectId: string,
  input: { name: string; type: string; width: number | null; depth: number | null; floor: number | null }
): Promise<ActionResult> {
  const supabase = createClient();
  if (!input.name.trim()) return { ok: false, error: "Room name is required." };
  const { error, data } = await supabase
    .from("rooms")
    .insert({
      project_id: projectId,
      name: input.name.trim(),
      type: input.type || null,
      width: input.width,
      depth: input.depth,
      floor: input.floor,
      estimated: false,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidate(projectId);
  return { ok: true, id: data.id };
}

export async function updateRoomDimensions(
  projectId: string,
  roomId: string,
  width: number | null,
  depth: number | null
): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("rooms").update({ width, depth }).eq("id", roomId);
  if (error) return { ok: false, error: error.message };
  revalidate(projectId);
  return { ok: true };
}

export async function deleteRoom(projectId: string, roomId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("rooms").delete().eq("id", roomId);
  if (error) return { ok: false, error: error.message };
  revalidate(projectId);
  return { ok: true };
}

export async function addTask(
  projectId: string,
  roomId: string,
  title: string,
  dueDate: string | null
): Promise<ActionResult> {
  const supabase = createClient();
  if (!title.trim()) return { ok: false, error: "Task title is required." };
  const { error } = await supabase.from("tasks").insert({ room_id: roomId, title: title.trim(), due_date: dueDate });
  if (error) return { ok: false, error: error.message };
  revalidate(projectId);
  return { ok: true };
}

export async function toggleTask(projectId: string, taskId: string, done: boolean): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("tasks").update({ done }).eq("id", taskId);
  if (error) return { ok: false, error: error.message };
  revalidate(projectId);
  return { ok: true };
}

export async function deleteTask(projectId: string, taskId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("tasks").delete().eq("id", taskId);
  if (error) return { ok: false, error: error.message };
  revalidate(projectId);
  return { ok: true };
}

export async function saveRendering(
  projectId: string,
  roomId: string,
  input: {
    style: StyleName;
    colors: string[];
    description: string;
    image_prompt: string;
    illustration_svg: string;
  }
): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("renderings").insert({
    room_id: roomId,
    style: input.style,
    colors: input.colors,
    description: input.description,
    image_prompt: input.image_prompt,
    illustration_svg: input.illustration_svg,
  });
  if (error) return { ok: false, error: error.message };
  revalidate(projectId);
  return { ok: true };
}

export async function saveRenderingPhoto(
  projectId: string,
  renderingId: string,
  photoUrl: string,
  label?: string
): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase
    .from("renderings")
    .update({ uploaded_photo_url: photoUrl })
    .eq("id", renderingId);
  if (error) return { ok: false, error: error.message };

  await recordProjectFile(supabase, {
    projectId,
    storageUrl: photoUrl,
    fileName: label ?? "Room rendering",
    category: "rendering",
    sourceTable: "renderings",
    sourceId: renderingId,
  });

  revalidate(projectId);
  return { ok: true };
}

export async function deleteRendering(projectId: string, renderingId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("renderings").delete().eq("id", renderingId);
  if (error) return { ok: false, error: error.message };
  await removeProjectFile(supabase, "renderings", renderingId);
  revalidate(projectId);
  return { ok: true };
}

export async function addFinish(
  projectId: string,
  roomId: string,
  input: { name: string; category: FinishCategory; brand: string | null; price: number | null }
): Promise<ActionResult> {
  const supabase = createClient();
  if (!input.name.trim()) return { ok: false, error: "Finish name is required." };
  const { error, data } = await supabase
    .from("finishes")
    .insert({
      room_id: roomId,
      name: input.name.trim(),
      category: input.category,
      brand: input.brand,
      price: input.price,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  // A priced finish (e.g. from a found product match) becomes a budget line
  // automatically — budgeted at the found price, nothing spent yet. Linked
  // via finish_id so deleting the finish removes this line too.
  if (input.price != null) {
    const label = input.brand ? `${input.name.trim()} (${input.brand})` : input.name.trim();
    const { error: budgetError } = await supabase.from("budget_items").insert({
      room_id: roomId,
      item: label,
      budgeted: input.price,
      actual: 0,
      finish_id: data.id,
    });
    if (budgetError) {
      return { ok: false, error: `Finish added, but budget line failed: ${budgetError.message}` };
    }
  }

  revalidate(projectId);
  return { ok: true, id: data.id };
}

export async function deleteFinish(projectId: string, finishId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("finishes").delete().eq("id", finishId);
  if (error) return { ok: false, error: error.message };
  revalidate(projectId);
  return { ok: true };
}
