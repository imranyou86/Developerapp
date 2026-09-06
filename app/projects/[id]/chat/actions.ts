"use server";

import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/app/projects/actions";

// No revalidatePath here — messages arrive for every viewer live via
// Supabase Realtime (see chat-client.tsx), so a server-driven refetch on
// send would just be redundant extra work.

export async function sendMessage(projectId: string, id: string, body: string): Promise<ActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, error: "Message can't be empty." };

  // id is generated client-side (crypto.randomUUID()) rather than left to
  // the column default, so the sender can recognize their own message when
  // it comes back over the Realtime subscription and reconcile it with the
  // optimistic entry already in their own message list instead of showing
  // a duplicate.
  const { error } = await supabase.from("project_messages").insert({
    id,
    project_id: projectId,
    user_id: user.id,
    sender_email: user.email ?? "unknown",
    body: trimmed,
  });
  if (error) return { ok: false, error: error.message };

  return { ok: true, id };
}

export async function deleteMessage(messageId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("project_messages").delete().eq("id", messageId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
