"use server";

import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/app/projects/actions";

export interface PushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  authKey: string;
}

// One row per browser/device — `onConflict: "endpoint"` means re-enabling
// on the same device after disabling it (or after the browser silently
// rotated the endpoint) just updates the existing row rather than erroring
// on the unique constraint or leaving a stale duplicate.
export async function savePushSubscription(input: PushSubscriptionInput): Promise<ActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase
    .from("push_subscriptions")
    .upsert({ user_id: user.id, endpoint: input.endpoint, p256dh: input.p256dh, auth_key: input.authKey }, { onConflict: "endpoint" });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function removePushSubscription(endpoint: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
