"use server";

import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/app/projects/actions";
import { notifyProjectSubscribers } from "@/lib/alerts";
import { CHAT_PAGE_SIZE } from "@/lib/pagination";
import type { ProjectMessage } from "@/lib/types";

// Cursor-paginated "load older" for a chat that's grown past the first
// page — the initial page load (chat/page.tsx) only fetches the most
// recent CHAT_PAGE_SIZE messages; this fetches the next page further back
// in time, ordered by created_at (with id as a tiebreaker for messages
// sharing the same instant, e.g. a bulk import).
export async function loadOlderMessages(
  projectId: string,
  beforeCreatedAt: string
): Promise<{ messages: ProjectMessage[]; hasMore: boolean }> {
  const supabase = createClient();
  const { data } = await supabase
    .from("project_messages")
    .select("id, project_id, user_id, sender_email, body, created_at")
    .eq("project_id", projectId)
    .lt("created_at", beforeCreatedAt)
    .order("created_at", { ascending: false })
    .limit(CHAT_PAGE_SIZE + 1);

  const rows = (data ?? []) as ProjectMessage[];
  const hasMore = rows.length > CHAT_PAGE_SIZE;
  const page = hasMore ? rows.slice(0, CHAT_PAGE_SIZE) : rows;
  return { messages: page.reverse(), hasMore };
}

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

  await notifyProjectSubscribers(projectId, {
    subject: "New chat message",
    body: `${user.email ?? "Someone"} wrote:\n\n${trimmed}`,
    excludeUserId: user.id,
  });

  return { ok: true, id };
}

export async function deleteMessage(messageId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("project_messages").delete().eq("id", messageId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
