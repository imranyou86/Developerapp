"use server";

import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/app/projects/actions";

function revalidate(projectId: string) {
  revalidatePath(`/projects/${projectId}`);
}

export async function createShareLink(projectId: string): Promise<ActionResult & { token?: string }> {
  const supabase = createClient();
  const token = crypto.randomBytes(24).toString("base64url");

  const { error, data } = await supabase
    .from("project_shares")
    .insert({ project_id: projectId, token })
    .select("id, token")
    .single();

  if (error) return { ok: false, error: error.message };
  revalidate(projectId);
  return { ok: true, id: data.id, token: data.token };
}

export async function revokeShareLink(projectId: string, shareId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase
    .from("project_shares")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", shareId);

  if (error) return { ok: false, error: error.message };
  revalidate(projectId);
  return { ok: true };
}
