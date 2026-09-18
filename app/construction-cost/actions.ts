"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/app/projects/actions";
import type { CostBreakdownLine, CostTier, PredictionConfidence, QualityTier } from "@/lib/types";

export interface SaveCostEstimateInput {
  title?: string | null;
  location?: string | null;
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

// projectId is null for a standalone estimate — one made in "Standalone
// Plan" mode, not tied to any construction tracked in this app.
export async function saveCostEstimate(projectId: string | null, input: SaveCostEstimateInput): Promise<ActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error, data } = await supabase
    .from("cost_estimates")
    .insert({ project_id: projectId, created_by: user.id, ...input })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };
  revalidatePath("/construction-cost");
  return { ok: true, id: data.id };
}

export async function deleteCostEstimate(estimateId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("cost_estimates").delete().eq("id", estimateId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/construction-cost");
  return { ok: true };
}
