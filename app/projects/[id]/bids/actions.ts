"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/app/projects/actions";
import { recordProjectFile, removeProjectFile } from "@/lib/projectFiles";

function revalidate(projectId: string) {
  revalidatePath(`/projects/${projectId}/bids`);
  // Accepting/declining/deleting a bid here changes what Payments shows too.
  revalidatePath(`/projects/${projectId}/payments`);
}

export interface SaveBidInput {
  contractor: string;
  total_amount: number;
  file_name: string | null;
  file_url: string | null;
  payment_schedule: { label: string; amount: number }[];
}

export async function saveBid(projectId: string, input: SaveBidInput): Promise<ActionResult> {
  const supabase = createClient();
  if (!input.contractor.trim()) return { ok: false, error: "Contractor name is required." };

  const { data: bid, error } = await supabase
    .from("bids")
    .insert({
      project_id: projectId,
      contractor: input.contractor.trim(),
      total_amount: input.total_amount,
      file_name: input.file_name,
      file_url: input.file_url,
      // Not every bid ends up accepted — often several competing bids come
      // in for the same scope. Lands here for review; only accepting it
      // (setBidStatus below) makes it show up on Payments at all.
      status: "pending",
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  if (input.file_url) {
    await recordProjectFile(supabase, {
      projectId,
      storageUrl: input.file_url,
      fileName: input.file_name ?? `${input.contractor} bid`,
      category: "bid",
      sourceTable: "bids",
      sourceId: bid.id,
    });
  }

  if (input.payment_schedule.length > 0) {
    const { error: scheduleError } = await supabase.from("payment_schedule_items").insert(
      input.payment_schedule.map((line) => ({ bid_id: bid.id, label: line.label, amount: line.amount }))
    );
    if (scheduleError) {
      return { ok: false, error: `Bid saved, but payment schedule failed: ${scheduleError.message}` };
    }
  }

  revalidate(projectId);
  return { ok: true, id: bid.id };
}

export async function setBidStatus(
  projectId: string,
  bidId: string,
  status: "pending" | "accepted" | "declined"
): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("bids").update({ status }).eq("id", bidId);
  if (error) return { ok: false, error: error.message };
  revalidate(projectId);
  return { ok: true };
}

export interface BidEvaluationInput {
  verdict: "good_price" | "fair_price" | "high_price";
  confidence: "high" | "medium" | "low";
  market_range_low: number | null;
  market_range_high: number | null;
  analysis: string;
}

export async function saveBidEvaluation(
  projectId: string,
  bidId: string,
  input: BidEvaluationInput
): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase
    .from("bids")
    .update({
      evaluation_verdict: input.verdict,
      evaluation_confidence: input.confidence,
      evaluation_market_low: input.market_range_low,
      evaluation_market_high: input.market_range_high,
      evaluation_analysis: input.analysis,
      evaluated_at: new Date().toISOString(),
    })
    .eq("id", bidId);
  if (error) return { ok: false, error: error.message };
  revalidate(projectId);
  return { ok: true };
}

export async function deleteBid(projectId: string, bidId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("bids").delete().eq("id", bidId);
  if (error) return { ok: false, error: error.message };
  await removeProjectFile(supabase, "bids", bidId);
  revalidate(projectId);
  return { ok: true };
}
