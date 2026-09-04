"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/app/projects/actions";
import type { FileCategory } from "@/lib/types";

export async function updateFileNotes(projectId: string, fileId: string, notes: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase
    .from("project_files")
    .update({ notes: notes.trim() || null })
    .eq("id", fileId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/projects/${projectId}/files`);
  return { ok: true };
}

// Manual uploads made from the Files tab itself, with no originating
// feature-table row — source_table/source_id stay null.
export async function uploadProjectFile(
  projectId: string,
  storageUrl: string,
  fileName: string,
  category: FileCategory
): Promise<ActionResult> {
  const supabase = createClient();
  const { error, data } = await supabase
    .from("project_files")
    .insert({ project_id: projectId, storage_url: storageUrl, file_name: fileName, category })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/projects/${projectId}/files`);
  return { ok: true, id: data.id };
}

export async function deleteProjectFile(projectId: string, fileId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("project_files").delete().eq("id", fileId).is("source_table", null);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/projects/${projectId}/files`);
  return { ok: true };
}
