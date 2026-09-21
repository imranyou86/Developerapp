"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/app/projects/actions";
import { recordProjectFile, removeProjectFile } from "@/lib/projectFiles";
import type { TradeBidConfidence, TradeBidVerdict } from "@/lib/types";

// Construction Cost's "Trade Bid Review" section — always tied to a real
// construction (unlike cost_estimates, this has no standalone mode: a
// subcontractor's trade bid only makes sense against an actual job).
function revalidate() {
  revalidatePath("/construction-cost");
}

export interface SaveTradeBidReviewInput {
  trade: string;
  subcontractor_name: string;
  subcontractor_id: string | null;
  bid_amount: number;
  scope_notes: string | null;
  file_name: string | null;
  file_url: string | null;
}

export async function saveTradeBidReview(projectId: string, input: SaveTradeBidReviewInput): Promise<ActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };
  if (!input.trade.trim()) return { ok: false, error: "Trade is required." };
  if (!input.subcontractor_name.trim()) return { ok: false, error: "Subcontractor name is required." };

  const { data, error } = await supabase
    .from("trade_bid_reviews")
    .insert({
      project_id: projectId,
      created_by: user.id,
      trade: input.trade.trim(),
      subcontractor_name: input.subcontractor_name.trim(),
      subcontractor_id: input.subcontractor_id,
      bid_amount: input.bid_amount,
      scope_notes: input.scope_notes?.trim() || null,
      file_name: input.file_name,
      file_url: input.file_url,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  if (input.file_url) {
    await recordProjectFile(supabase, {
      projectId,
      storageUrl: input.file_url,
      fileName: input.file_name ?? `${input.subcontractor_name} bid`,
      category: "trade_bid",
      sourceTable: "trade_bid_reviews",
      sourceId: data.id,
    });
  }

  revalidate();
  return { ok: true, id: data.id };
}

export interface TradeBidEvaluationInput {
  verdict: TradeBidVerdict;
  confidence: TradeBidConfidence;
  market_range_low: number | null;
  market_range_high: number | null;
  analysis: string;
  questions_to_ask: string[];
  scope_complete: boolean | null;
  missing_items: string[];
  completeness_note: string;
}

export async function saveTradeBidEvaluation(reviewId: string, input: TradeBidEvaluationInput): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase
    .from("trade_bid_reviews")
    .update({
      evaluation_verdict: input.verdict,
      evaluation_confidence: input.confidence,
      evaluation_market_low: input.market_range_low,
      evaluation_market_high: input.market_range_high,
      evaluation_analysis: input.analysis,
      evaluation_questions: input.questions_to_ask,
      evaluation_scope_complete: input.scope_complete,
      evaluation_missing_items: input.missing_items,
      evaluation_completeness_note: input.completeness_note,
      evaluated_at: new Date().toISOString(),
    })
    .eq("id", reviewId);
  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true };
}

export async function deleteTradeBidReview(reviewId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("trade_bid_reviews").delete().eq("id", reviewId);
  if (error) return { ok: false, error: error.message };
  await removeProjectFile(supabase, "trade_bid_reviews", reviewId);
  revalidate();
  return { ok: true };
}
