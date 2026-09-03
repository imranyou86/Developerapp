"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/app/projects/actions";
import type { DealComp, DealScope, DealVerdict } from "@/lib/types";

export interface SaveDealAnalysisInput {
  scope: DealScope;
  scope_description: string;
  target_sqft: number | null;
  cost_per_sqft: number;
  construction_budget: number;
  current_value_estimate: number | null;
  arv_estimate: number;
  arv_low: number;
  arv_high: number;
  total_cost: number;
  estimated_profit: number;
  profit_margin_pct: number;
  verdict: DealVerdict;
  reasoning: string;
  comps: DealComp[];
}

export async function saveDealAnalysis(dealId: string, input: SaveDealAnalysisInput): Promise<ActionResult> {
  const supabase = createClient();
  const { error, data } = await supabase
    .from("deal_analyses")
    .insert({ deal_id: dealId, ...input })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };
  revalidatePath(`/deals/${dealId}`);
  return { ok: true, id: data.id };
}
