"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activityLog";
import { signRowsUrl } from "@/lib/storage";
import { FILES_PAGE_SIZE } from "@/lib/pagination";
import type { ActionResult } from "@/app/projects/actions";
import type { FileCategory, ProjectFile } from "@/lib/types";

// The Files Library loads its first page server-side (files/page.tsx,
// newest first); a project with more than FILES_PAGE_SIZE files loads the
// rest on demand here rather than fetching everything up front.
export async function loadMoreProjectFiles(
  projectId: string,
  beforeCreatedAt: string
): Promise<{ files: ProjectFile[]; hasMore: boolean }> {
  const supabase = createClient();
  const { data } = await supabase
    .from("project_files")
    .select("id, project_id, storage_url, file_name, category, source_table, source_id, notes, created_at")
    .eq("project_id", projectId)
    .lt("created_at", beforeCreatedAt)
    .order("created_at", { ascending: false })
    .limit(FILES_PAGE_SIZE + 1);

  const rows = (data ?? []) as ProjectFile[];
  const hasMore = rows.length > FILES_PAGE_SIZE;
  const page = hasMore ? rows.slice(0, FILES_PAGE_SIZE) : rows;
  return { files: await signRowsUrl(page, "storage_url"), hasMore };
}

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

export async function deleteProjectFile(projectId: string, fileId: string, fileName?: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("project_files").delete().eq("id", fileId).is("source_table", null);
  if (error) return { ok: false, error: error.message };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  await logActivity(supabase, {
    projectId,
    userId: user?.id ?? null,
    action: "project_file.deleted",
    entityType: "project_files",
    entityId: fileId,
    detail: fileName ? `Deleted "${fileName}"` : "Deleted a file",
  });

  revalidatePath(`/projects/${projectId}/files`);
  return { ok: true };
}

// Same "manual upload only" restriction as the single-file delete above
// (.is("source_table", null)) — a checked file that actually came from
// another tab (a rendering, a checklist photo, a plan page, …) is silently
// skipped rather than erroring, since deleting it here would desync it from
// the feature it belongs to; the client tells the user how many were
// skipped. Returns the ids that were actually deleted so the client can
// update local state/selection without a full refetch.
export async function deleteProjectFiles(projectId: string, fileIds: string[]): Promise<ActionResult & { deletedIds?: string[] }> {
  if (fileIds.length === 0) return { ok: true, deletedIds: [] };
  const supabase = createClient();
  const { data, error } = await supabase
    .from("project_files")
    .delete()
    .in("id", fileIds)
    .is("source_table", null)
    .select("id");
  if (error) return { ok: false, error: error.message };

  const deletedIds = (data ?? []).map((row) => row.id);
  if (deletedIds.length > 0) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await logActivity(supabase, {
      projectId,
      userId: user?.id ?? null,
      action: "project_file.bulk_deleted",
      entityType: "project_files",
      detail: `Deleted ${deletedIds.length} file${deletedIds.length === 1 ? "" : "s"}`,
    });
  }

  revalidatePath(`/projects/${projectId}/files`);
  return { ok: true, deletedIds };
}
