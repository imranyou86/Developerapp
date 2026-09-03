"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/app/projects/actions";

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
