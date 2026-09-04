import type { SupabaseClient } from "@supabase/supabase-js";
import type { FileCategory } from "@/lib/types";

// Keeps the project_files aggregation table (the File Library) in sync with
// every feature's own upload/delete actions. Best-effort by design — a
// bookkeeping failure here should never fail the actual upload/delete the
// user asked for, so errors are logged and swallowed rather than thrown.

interface RecordFileInput {
  projectId: string;
  storageUrl: string;
  fileName: string;
  category: FileCategory;
  sourceTable: string;
  sourceId: string;
}

// Upsert-by-source: deletes any existing library row for this source first,
// so replacing a file (e.g. re-uploading a rendering photo) doesn't leave a
// stale duplicate behind — source_table + source_id identify the
// originating row 1:1.
export async function recordProjectFile(supabase: SupabaseClient, input: RecordFileInput): Promise<void> {
  try {
    await supabase.from("project_files").delete().eq("source_table", input.sourceTable).eq("source_id", input.sourceId);
    const { error } = await supabase.from("project_files").insert({
      project_id: input.projectId,
      storage_url: input.storageUrl,
      file_name: input.fileName,
      category: input.category,
      source_table: input.sourceTable,
      source_id: input.sourceId,
    });
    if (error) console.warn("recordProjectFile insert failed (non-fatal):", error.message);
  } catch (err) {
    console.warn("recordProjectFile failed (non-fatal):", err);
  }
}

export async function removeProjectFile(supabase: SupabaseClient, sourceTable: string, sourceId: string): Promise<void> {
  try {
    const { error } = await supabase.from("project_files").delete().eq("source_table", sourceTable).eq("source_id", sourceId);
    if (error) console.warn("removeProjectFile failed (non-fatal):", error.message);
  } catch (err) {
    console.warn("removeProjectFile failed (non-fatal):", err);
  }
}

// Stored file_name values are often a human label ("Living Room — Modern
// Farmhouse") rather than a real filename, so downloads need the extension
// from the storage URL appended for the saved file to open correctly.
export function withExtension(fileName: string, storageUrl: string): string {
  const urlExt = storageUrl.split("?")[0].split(".").pop();
  if (!urlExt || urlExt.length > 5) return fileName;
  return fileName.toLowerCase().endsWith(`.${urlExt.toLowerCase()}`) ? fileName : `${fileName}.${urlExt}`;
}
