"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/app/projects/actions";
import type { FinishCategory, StyleName } from "@/lib/types";
import { recordProjectFile, removeProjectFile } from "@/lib/projectFiles";
import { notifyForAction } from "@/lib/alerts";

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

export async function toggleTasks(projectId: string, taskIds: string[], done: boolean): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("tasks").update({ done }).in("id", taskIds);
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

export async function deleteTasks(projectId: string, taskIds: string[]): Promise<ActionResult & { deletedIds?: string[] }> {
  const supabase = createClient();
  const { data, error } = await supabase.from("tasks").delete().in("id", taskIds).select("id");
  if (error) return { ok: false, error: error.message };
  revalidate(projectId);
  return { ok: true, deletedIds: (data ?? []).map((d) => d.id) };
}

export async function saveRendering(
  projectId: string,
  roomId: string,
  input: {
    style: StyleName;
    colors: string[];
    description: string;
    // Only one of these is ever populated per rendering now — the concept
    // route is asked for whichever one the person picked (Gemini or
    // Midjourney) when queuing the style, not both every time.
    image_prompt: string | null;
    midjourney_prompt: string | null;
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
    midjourney_prompt: input.midjourney_prompt,
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
  label?: string,
  imagePrompt?: string
): Promise<ActionResult> {
  const supabase = createClient();
  // imagePrompt is passed whenever the photo being saved is the direct
  // result of a prompt (a fresh AI generation, or an "Add to this image"
  // edit) — keeping image_prompt in sync so it always describes what's
  // actually in the photo, not what generated an earlier version of it.
  // A plain manual photo upload omits it, leaving image_prompt untouched.
  const update: { uploaded_photo_url: string; image_prompt?: string } = { uploaded_photo_url: photoUrl };
  if (imagePrompt != null) update.image_prompt = imagePrompt;
  const { error } = await supabase.from("renderings").update(update).eq("id", renderingId);
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

// One rough-in documentation pass on a room — created once, then media
// (photos/video) is added to it one upload at a time via addRoughInMedia.
export async function saveRoughInCapture(
  projectId: string,
  roomId: string,
  input: { roomLabel: string; trades: string[]; notes: string | null }
): Promise<ActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };
  if (!input.roomLabel.trim()) return { ok: false, error: "Room name is required." };

  const { error, data } = await supabase
    .from("rough_in_captures")
    .insert({
      project_id: projectId,
      room_id: roomId,
      room_label: input.roomLabel.trim(),
      trades: input.trades,
      notes: input.notes?.trim() || null,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  await notifyForAction(projectId, "rough_in_captured", {
    subject: "Rough-in documented",
    body: `${input.roomLabel.trim()} was documented before drywall${
      input.trades.length > 0 ? ` (${input.trades.join(", ")})` : ""
    }.`,
  });

  revalidate(projectId);
  return { ok: true, id: data.id };
}

export async function addRoughInMedia(
  projectId: string,
  captureId: string,
  media: { mediaType: "photo" | "video"; storageUrl: string; fileName: string | null }
): Promise<ActionResult> {
  const supabase = createClient();
  const { error, data } = await supabase
    .from("rough_in_media")
    .insert({
      capture_id: captureId,
      media_type: media.mediaType,
      storage_url: media.storageUrl,
      file_name: media.fileName,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  await recordProjectFile(supabase, {
    projectId,
    storageUrl: media.storageUrl,
    fileName: media.fileName ?? (media.mediaType === "video" ? "Rough-in video" : "Rough-in photo"),
    category: "rough_in",
    sourceTable: "rough_in_media",
    sourceId: data.id,
  });

  revalidate(projectId);
  return { ok: true, id: data.id };
}

export async function deleteRoughInMedia(projectId: string, mediaId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("rough_in_media").delete().eq("id", mediaId);
  if (error) return { ok: false, error: error.message };
  await removeProjectFile(supabase, "rough_in_media", mediaId);
  revalidate(projectId);
  return { ok: true };
}

export async function deleteRoughInCapture(projectId: string, captureId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { data: media } = await supabase.from("rough_in_media").select("id").eq("capture_id", captureId);
  const { error } = await supabase.from("rough_in_captures").delete().eq("id", captureId);
  if (error) return { ok: false, error: error.message };
  await Promise.all((media ?? []).map((m) => removeProjectFile(supabase, "rough_in_media", m.id)));
  revalidate(projectId);
  return { ok: true };
}
