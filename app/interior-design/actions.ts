"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { recordProjectFile, removeProjectFile } from "@/lib/projectFiles";
import type { ActionResult } from "@/app/projects/actions";

function revalidate(projectId: string) {
  revalidatePath(`/interior-design`);
  revalidatePath(`/projects/${projectId}/files`);
}

export interface SaveInteriorDesignInput {
  roomId: string | null;
  roomType: string;
  style: string;
  width: number | null;
  depth: number | null;
  sqft: number | null;
  originalPhotoUrl: string;
  generatedImageUrl: string;
  prompt: string;
}

export async function saveInteriorDesign(projectId: string, input: SaveInteriorDesignInput): Promise<ActionResult> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("interior_designs")
    .insert({
      project_id: projectId,
      room_id: input.roomId,
      room_type: input.roomType,
      style: input.style,
      width: input.width,
      depth: input.depth,
      sqft: input.sqft,
      original_photo_url: input.originalPhotoUrl,
      generated_image_url: input.generatedImageUrl,
      prompt: input.prompt,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  const label = `${input.roomType} — ${input.style}`;
  // Two files per design row (the "before" photo and the AI "after"
  // render), so each gets its own source_id — the unique index on
  // (source_table, source_id) is per-row, not per-design.
  await recordProjectFile(supabase, {
    projectId,
    storageUrl: input.originalPhotoUrl,
    fileName: `${label} (before)`,
    category: "photo",
    sourceTable: "interior_designs",
    sourceId: `${data.id}:original`,
  });
  await recordProjectFile(supabase, {
    projectId,
    storageUrl: input.generatedImageUrl,
    fileName: `${label} (design)`,
    category: "interior_design",
    sourceTable: "interior_designs",
    sourceId: data.id,
  });

  revalidate(projectId);
  return { ok: true, id: data.id };
}

export async function deleteInteriorDesign(projectId: string, designId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("interior_designs").delete().eq("id", designId);
  if (error) return { ok: false, error: error.message };

  await removeProjectFile(supabase, "interior_designs", `${designId}:original`);
  await removeProjectFile(supabase, "interior_designs", designId);

  revalidate(projectId);
  return { ok: true };
}
