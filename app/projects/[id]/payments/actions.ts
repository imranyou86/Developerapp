"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/app/projects/actions";
import { recordProjectFile, removeProjectFile } from "@/lib/projectFiles";

function revalidate(projectId: string) {
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

export async function deleteBid(projectId: string, bidId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("bids").delete().eq("id", bidId);
  if (error) return { ok: false, error: error.message };
  await removeProjectFile(supabase, "bids", bidId);
  revalidate(projectId);
  return { ok: true };
}

export async function markPaymentPaid(projectId: string, lineId: string, paid: boolean): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("payment_schedule_items").update({ paid }).eq("id", lineId);
  if (error) return { ok: false, error: error.message };
  revalidate(projectId);
  return { ok: true };
}

// Adding/editing/removing a line on an already-saved bid keeps the bid's
// total_amount in sync by the same delta rather than recomputing it as
// sum(lines) outright — total_amount can legitimately differ from the sum
// of extracted lines from the start (see ReviewBidModal's mismatch
// warning), and this preserves whatever that original gap was instead of
// silently erasing it the first time someone adds an overage or fixes a
// typo'd amount. No transaction here (consistent with the rest of this
// app's server actions) — acceptable for a single-admin-editing-at-a-time
// tool like this, not a high-concurrency ledger.
async function adjustBidTotal(
  supabase: ReturnType<typeof createClient>,
  bidId: string,
  delta: number
): Promise<{ ok: true; newTotal: number } | { ok: false; error: string }> {
  if (delta === 0) {
    const { data: bid, error } = await supabase.from("bids").select("total_amount").eq("id", bidId).single();
    if (error || !bid) return { ok: false, error: error?.message ?? "Bid not found." };
    return { ok: true, newTotal: Number(bid.total_amount) };
  }
  const { data: bid, error: fetchError } = await supabase.from("bids").select("total_amount").eq("id", bidId).single();
  if (fetchError || !bid) return { ok: false, error: fetchError?.message ?? "Bid not found." };
  const newTotal = Number(bid.total_amount) + delta;
  const { error } = await supabase.from("bids").update({ total_amount: newTotal }).eq("id", bidId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, newTotal };
}

export async function addPaymentLine(
  projectId: string,
  bidId: string,
  input: { label: string; amount: number }
): Promise<ActionResult & { newTotal?: number }> {
  const supabase = createClient();
  if (!input.label.trim()) return { ok: false, error: "Description is required." };

  const { data: line, error } = await supabase
    .from("payment_schedule_items")
    .insert({ bid_id: bidId, label: input.label.trim(), amount: input.amount })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  const totalRes = await adjustBidTotal(supabase, bidId, input.amount);
  if (!totalRes.ok) return { ok: true, id: line.id, error: `Item added, but updating the bid total failed: ${totalRes.error}` };

  revalidate(projectId);
  return { ok: true, id: line.id, newTotal: totalRes.newTotal };
}

export async function updatePaymentLine(
  projectId: string,
  bidId: string,
  lineId: string,
  input: { label: string; amount: number }
): Promise<ActionResult & { newTotal?: number }> {
  const supabase = createClient();
  if (!input.label.trim()) return { ok: false, error: "Description is required." };

  const { data: existing, error: fetchError } = await supabase
    .from("payment_schedule_items")
    .select("amount")
    .eq("id", lineId)
    .single();
  if (fetchError || !existing) return { ok: false, error: fetchError?.message ?? "Line item not found." };

  const { error } = await supabase
    .from("payment_schedule_items")
    .update({ label: input.label.trim(), amount: input.amount })
    .eq("id", lineId);
  if (error) return { ok: false, error: error.message };

  const totalRes = await adjustBidTotal(supabase, bidId, input.amount - Number(existing.amount));
  if (!totalRes.ok) return { ok: true, error: `Item updated, but updating the bid total failed: ${totalRes.error}` };

  revalidate(projectId);
  return { ok: true, newTotal: totalRes.newTotal };
}

export async function deletePaymentLine(
  projectId: string,
  bidId: string,
  lineId: string
): Promise<ActionResult & { newTotal?: number }> {
  const supabase = createClient();
  const { data: existing, error: fetchError } = await supabase
    .from("payment_schedule_items")
    .select("amount")
    .eq("id", lineId)
    .single();
  if (fetchError || !existing) return { ok: false, error: fetchError?.message ?? "Line item not found." };

  const { error } = await supabase.from("payment_schedule_items").delete().eq("id", lineId);
  if (error) return { ok: false, error: error.message };

  const totalRes = await adjustBidTotal(supabase, bidId, -Number(existing.amount));
  if (!totalRes.ok) return { ok: true, error: `Item removed, but updating the bid total failed: ${totalRes.error}` };

  revalidate(projectId);
  return { ok: true, newTotal: totalRes.newTotal };
}
