import { createClient } from "@/lib/supabase/server";
import { signRowsUrl } from "@/lib/storage";
import { FILES_PAGE_SIZE } from "@/lib/pagination";
import { FilesClient } from "@/app/projects/[id]/files/files-client";

export const dynamic = "force-dynamic";

export default async function FilesPage({ params }: { params: { id: string } }) {
  const supabase = createClient();

  const { data: files, error } = await supabase
    .from("project_files")
    .select("id, project_id, storage_url, file_name, category, source_table, source_id, notes, created_at")
    .eq("project_id", params.id)
    .order("created_at", { ascending: false })
    .limit(FILES_PAGE_SIZE + 1);

  const rows = files ?? [];
  const hasMore = rows.length > FILES_PAGE_SIZE;
  const page = hasMore ? rows.slice(0, FILES_PAGE_SIZE) : rows;
  const signedFiles = await signRowsUrl(page, "storage_url");

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          Could not load files: {error.message}
        </div>
      )}
      <FilesClient projectId={params.id} initialFiles={signedFiles} initialHasMore={hasMore} />
    </div>
  );
}
