"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/app/projects/actions";

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
