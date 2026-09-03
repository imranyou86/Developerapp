import { createClient } from "@/lib/supabase/server";
import { FinishIdClient } from "@/app/projects/[id]/finish-id/finish-id-client";

export const dynamic = "force-dynamic";

export default async function FinishIdPage({ params }: { params: { id: string } }) {
  const supabase = createClient();

  const [{ data: rooms }, { data: scans, error }] = await Promise.all([
    supabase.from("rooms").select("id, name").eq("project_id", params.id).order("name", { ascending: true }),
    supabase
      .from("finish_scans")
      .select("id, storage_url, label, results, created_at")
      .eq("project_id", params.id)
      .order("created_at", { ascending: false }),
  ]);

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          Could not load scan history: {error.message}
        </div>
      )}
      <FinishIdClient projectId={params.id} rooms={rooms ?? []} initialScans={scans ?? []} />
    </div>
  );
}
