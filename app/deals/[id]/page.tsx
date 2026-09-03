import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DealDetailClient } from "@/app/deals/[id]/deal-detail-client";

export const dynamic = "force-dynamic";

export default async function DealDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient();

  const [{ data: deal }, { data: analyses }] = await Promise.all([
    supabase.from("deals").select("*").eq("id", params.id).maybeSingle(),
    supabase
      .from("deal_analyses")
      .select("*")
      .eq("deal_id", params.id)
      .order("created_at", { ascending: false }),
  ]);

  if (!deal) notFound();

  return <DealDetailClient deal={deal} initialAnalyses={analyses ?? []} />;
}
