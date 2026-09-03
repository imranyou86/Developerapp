"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/app/projects/actions";
import type { IdentifiedFinish } from "@/lib/types";

function revalidate(projectId: string) {
  revalidatePath(`/projects/${projectId}/finish-id`);
}

export async function saveFinishScan(
  projectId: string,
  storageUrl: string,
  label: string | null,
  results: IdentifiedFinish[]
): Promise<ActionResult> {
  const supabase = createClient();
  const { error, data } = await supabase
    .from("finish_scans")
    .insert({ project_id: projectId, storage_url: storageUrl, label, results })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidate(projectId);
  return { ok: true, id: data.id };
}

export async function deleteFinishScan(projectId: string, scanId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("finish_scans").delete().eq("id", scanId);
  if (error) return { ok: false, error: error.message };
  revalidate(projectId);
  return { ok: true };
}
