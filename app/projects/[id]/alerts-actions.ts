"use server";

import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/app/projects/actions";

export async function subscribeToAlerts(projectId: string): Promise<ActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase
    .from("project_alert_subscriptions")
    .upsert({ project_id: projectId, user_id: user.id, email: user.email ?? "" }, { onConflict: "project_id,user_id" });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function unsubscribeFromAlerts(projectId: string): Promise<ActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase
    .from("project_alert_subscriptions")
    .delete()
    .eq("project_id", projectId)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
