"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { recordProjectFile, removeProjectFile } from "@/lib/projectFiles";
import type { ActionResult } from "@/app/projects/actions";
import type { PlacedFixture } from "@/lib/types";

function revalidate(projectId: string | null) {
  revalidatePath(`/landscape`);
  if (projectId) revalidatePath(`/projects/${projectId}/files`);
}

export interface SaveLandscapeDesignInput {
  style: string;
  notes: string | null;
  originalPhotoUrl: string;
  generatedImageUrl: string;
  prompt: string;
  layout: PlacedFixture[];
  yardWidth: number | null;
  yardDepth: number | null;
}

export async function saveLandscapeDesign(projectId: string | null, input: SaveLandscapeDesignInput): Promise<ActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data, error } = await supabase
    .from("landscape_designs")
    .insert({
      project_id: projectId,
      created_by: user.id,
      style: input.style,
      notes: input.notes,
      original_photo_url: input.originalPhotoUrl,
      generated_image_url: input.generatedImageUrl,
      prompt: input.prompt,
      layout: input.layout,
      yard_width: input.yardWidth,
      yard_depth: input.yardDepth,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  // A standalone design (no construction) has nowhere to file these — the
  // File Library is per-project.
  if (projectId) {
    const label = `Landscape — ${input.style}`;
    await recordProjectFile(supabase, {
      projectId,
      storageUrl: input.originalPhotoUrl,
      fileName: `${label} (before)`,
      category: "photo",
      sourceTable: "landscape_designs",
      sourceId: `${data.id}:original`,
    });
    await recordProjectFile(supabase, {
      projectId,
      storageUrl: input.generatedImageUrl,
      fileName: `${label} (design)`,
      category: "landscape_design",
      sourceTable: "landscape_designs",
      sourceId: data.id,
    });
  }

  revalidate(projectId);
  return { ok: true, id: data.id };
}

// "Add to this image" — a follow-up edit pass chained onto the CURRENTLY
// generated image (not the original before-photo), so edits stack. Re-uses
// the design row's existing source_id when re-recording the project file so
// the Files Library entry is replaced in place, not duplicated.
export async function updateLandscapeDesignImage(
  projectId: string | null,
  designId: string,
  input: { style: string; generatedImageUrl: string; prompt: string }
): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase
    .from("landscape_designs")
    .update({ generated_image_url: input.generatedImageUrl, prompt: input.prompt })
    .eq("id", designId);
  if (error) return { ok: false, error: error.message };

  if (projectId) {
    await recordProjectFile(supabase, {
      projectId,
      storageUrl: input.generatedImageUrl,
      fileName: `Landscape — ${input.style} (design)`,
      category: "landscape_design",
      sourceTable: "landscape_designs",
      sourceId: designId,
    });
  }

  revalidate(projectId);
  return { ok: true, id: designId };
}

export async function deleteLandscapeDesign(projectId: string | null, designId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("landscape_designs").delete().eq("id", designId);
  if (error) return { ok: false, error: error.message };

  if (projectId) {
    await removeProjectFile(supabase, "landscape_designs", `${designId}:original`);
    await removeProjectFile(supabase, "landscape_designs", designId);
  }

  revalidate(projectId);
  return { ok: true };
}
