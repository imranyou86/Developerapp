"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/app/projects/actions";
import type { CostBreakdownLine, CostTier, PredictionConfidence, QualityTier } from "@/lib/types";

export interface SaveCostEstimateInput {
  total_sqft: number;
  stories: number | null;
  quality_tier: QualityTier;
  cost_tier: CostTier;
  cost_per_sqft_low: number;
  cost_per_sqft_mid: number;
  cost_per_sqft_high: number;
  total_cost_low: number;
  total_cost_mid: number;
  total_cost_high: number;
  predicted_cost_per_sqft: number;
  contingency_pct: number;
  predicted_total_cost: number;
  prediction_confidence: PredictionConfidence;
  prediction_notes: string;
  complexity_factors: string[];
  breakdown: CostBreakdownLine[];
  reasoning: string;
}

export async function saveCostEstimate(projectId: string, input: SaveCostEstimateInput): Promise<ActionResult> {
  const supabase = createClient();
  const { error, data } = await supabase
    .from("cost_estimates")
    .insert({ project_id: projectId, ...input })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };
  revalidatePath(`/projects/${projectId}/cost`);
  return { ok: true, id: data.id };
}

export async function deleteCostEstimate(projectId: string, estimateId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("cost_estimates").delete().eq("id", estimateId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/projects/${projectId}/cost`);
  return { ok: true };
}
