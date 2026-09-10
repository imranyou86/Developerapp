import { createClient } from "@/lib/supabase/server";
import { signRowsUrl } from "@/lib/storage";
import { PlanClient } from "@/app/projects/[id]/plan/plan-client";

export const dynamic = "force-dynamic";

export default async function PlanPage({ params }: { params: { id: string } }) {
  const supabase = createClient();

  const [{ data: pages }, { data: rooms }] = await Promise.all([
    supabase
      .from("plan_pages")
      .select("id, storage_url, label, sort_order, is_layout")
      .eq("project_id", params.id)
      .order("sort_order", { ascending: true }),
    supabase.from("rooms").select("name").eq("project_id", params.id),
  ]);

  const signedPages = await signRowsUrl(pages ?? [], "storage_url");

  return (
    <PlanClient
      projectId={params.id}
      initialPages={signedPages}
      existingRoomNames={(rooms ?? []).map((r) => r.name)}
    />
  );
}
