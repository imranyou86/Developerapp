"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/app/projects/actions";

function revalidate(projectId: string) {
  revalidatePath(`/projects/${projectId}/budget`);
  revalidatePath(`/projects`);
}

export async function addBudgetItem(
  projectId: string,
  roomId: string,
  input: { item: string; budgeted: number; actual: number }
): Promise<ActionResult> {
  const supabase = createClient();
  if (!input.item.trim()) return { ok: false, error: "Item name is required." };
  const { error, data } = await supabase
    .from("budget_items")
    .insert({ room_id: roomId, item: input.item.trim(), budgeted: input.budgeted, actual: input.actual })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidate(projectId);
  return { ok: true, id: data.id };
}

export async function updateBudgetItem(
  projectId: string,
  itemId: string,
  input: { budgeted: number; actual: number }
): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase
    .from("budget_items")
    .update({ budgeted: input.budgeted, actual: input.actual })
    .eq("id", itemId);
  if (error) return { ok: false, error: error.message };
  revalidate(projectId);
  return { ok: true };
}

export async function deleteBudgetItem(projectId: string, itemId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("budget_items").delete().eq("id", itemId);
  if (error) return { ok: false, error: error.message };
  revalidate(projectId);
  return { ok: true };
}
