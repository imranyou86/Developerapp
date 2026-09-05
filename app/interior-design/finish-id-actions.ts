"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/app/projects/actions";
import type { IdentifiedFinish } from "@/lib/types";

// Finish ID is universal now (nested under Interior Design, not a
// per-project tab) — a scan isn't scoped to a construction up front, so
// there's no projectId here. Sending specific identified finishes to a
// construction's room still goes through addFinish (rooms/actions.ts),
// unchanged, from the client once the user picks a target there.

export async function saveFinishScan(storageUrl: string, label: string | null, results: IdentifiedFinish[]): Promise<ActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error, data } = await supabase
    .from("finish_scans")
    .insert({ created_by: user.id, storage_url: storageUrl, label, results })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  revalidatePath("/interior-design");
  return { ok: true, id: data.id };
}

export async function deleteFinishScan(scanId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("finish_scans").delete().eq("id", scanId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/interior-design");
  return { ok: true };
}
