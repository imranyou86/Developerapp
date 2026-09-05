"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { recordProjectFile, removeProjectFile } from "@/lib/projectFiles";
import type { ActionResult } from "@/app/projects/actions";
import type { LandscapeComponentSelection } from "@/lib/types";

function revalidate(projectId: string | null) {
  revalidatePath(`/landscape`);
  if (projectId) revalidatePath(`/projects/${projectId}/files`);
}

export interface SaveLandscapeDesignInput {
  style: string;
  components: LandscapeComponentSelection[];
  notes: string | null;
  originalPhotoUrl: string;
  generatedImageUrl: string;
  prompt: string;
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
      components: input.components,
      notes: input.notes,
      original_photo_url: input.originalPhotoUrl,
      generated_image_url: input.generatedImageUrl,
      prompt: input.prompt,
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
