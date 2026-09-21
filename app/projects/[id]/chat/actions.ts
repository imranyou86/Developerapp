"use server";

import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/app/projects/actions";
import { notifyForAction, notifyThreadParticipants } from "@/lib/alerts";
import { CHAT_PAGE_SIZE } from "@/lib/pagination";
import type { ProjectMessage } from "@/lib/types";

// Cursor-paginated message fetch, newest page first — used both for a
// thread's initial load (beforeCreatedAt omitted, e.g. switching to it in
// the sidebar) and "load older" once it's grown past the first page
// (chat/page.tsx's own SSR query covers General's very first load).
// threadId null means the project-wide General chat; a thread's own id
// scopes to that thread only (RLS enforces the same either way — this
// just filters which page loads).
export async function loadMessages(
  projectId: string,
  threadId: string | null,
  beforeCreatedAt?: string
): Promise<{ messages: ProjectMessage[]; hasMore: boolean }> {
  const supabase = createClient();
  let query = supabase
    .from("project_messages")
    .select("id, project_id, user_id, sender_email, sender_name, body, created_at, thread_id")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(CHAT_PAGE_SIZE + 1);
  query = threadId ? query.eq("thread_id", threadId) : query.is("thread_id", null);
  if (beforeCreatedAt) query = query.lt("created_at", beforeCreatedAt);
  const { data } = await query;

  const rows = (data ?? []) as ProjectMessage[];
  const hasMore = rows.length > CHAT_PAGE_SIZE;
  const page = hasMore ? rows.slice(0, CHAT_PAGE_SIZE) : rows;
  return { messages: page.reverse(), hasMore };
}

// No revalidatePath here — messages arrive for every viewer live via
// Supabase Realtime (see chat-client.tsx), so a server-driven refetch on
// send would just be redundant extra work.

export async function sendMessage(projectId: string, threadId: string | null, id: string, body: string): Promise<ActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, error: "Message can't be empty." };

  // profiles_select only lets a user read their own row, so this looks up
  // the sender's own display name (set, if at all, from Admin) to
  // denormalize onto the message the same way sender_email already is —
  // see migration 050_user_display_names.sql.
  const { data: profile } = await supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle();
  const senderName = profile?.display_name || null;

  // id is generated client-side (crypto.randomUUID()) rather than left to
  // the column default, so the sender can recognize their own message when
  // it comes back over the Realtime subscription and reconcile it with the
  // optimistic entry already in their own message list instead of showing
  // a duplicate.
  const { error } = await supabase.from("project_messages").insert({
    id,
    project_id: projectId,
    thread_id: threadId,
    user_id: user.id,
    sender_email: user.email ?? "unknown",
    sender_name: senderName,
    body: trimmed,
  });
  if (error) return { ok: false, error: error.message };

  if (threadId) {
    const { data: participants } = await supabase.from("chat_thread_participants").select("user_id").eq("thread_id", threadId);
    await notifyThreadParticipants(
      projectId,
      (participants ?? []).map((p) => p.user_id),
      {
        subject: "New chat message",
        body: `${senderName ?? user.email ?? "Someone"} sent a chat message:\n\n${trimmed}`,
        excludeUserId: user.id,
      }
    );
  } else {
    // No excludeUserId here (unlike checklist/warranty notifications) — a
    // subscribed account gets emailed about every new chat message,
    // including its own, so someone watching a project's chat by email
    // sees a complete thread rather than a gapped one missing their own
    // replies.
    await notifyForAction(projectId, "chat_message", {
      subject: "New chat message",
      body: `${senderName ?? user.email ?? "Someone"} sent a chat message:\n\n${trimmed}`,
    });
  }

  return { ok: true, id };
}

export async function deleteMessage(messageId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("project_messages").delete().eq("id", messageId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// Wipes the General chat for this construction only — thread messages are
// untouched (delete the thread itself, via deleteChatThread in
// thread-actions.ts, to wipe one of those). A stronger action than
// deleting a single message, so it's Developer-only (matches
// project_messages_delete's RLS: auth.uid() = user_id or is_developer(),
// which already lets a Developer delete any message, not just their own).
// Every other viewer's chat clears live via the existing Realtime DELETE
// listener in chat-client.tsx, one event per deleted row.
export async function clearChat(projectId: string): Promise<ActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "developer") return { ok: false, error: "Only a Developer can clear this chat." };

  const { error } = await supabase.from("project_messages").delete().eq("project_id", projectId).is("thread_id", null);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// Marks a chat surface as read up to now for the current user — called by
// ProjectTabs (app/projects/[id]/project-tabs.tsx) for the General chat
// (threadId omitted) whenever it's the active tab, and by the thread view
// for whichever thread is open. No revalidatePath: this only feeds unread
// badges, which update locally on the client.
export async function markChatRead(projectId: string, threadId?: string): Promise<ActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  if (threadId) {
    const { error } = await supabase
      .from("chat_thread_reads")
      .upsert({ thread_id: threadId, user_id: user.id, last_read_at: new Date().toISOString() }, { onConflict: "thread_id,user_id" });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  const { error } = await supabase
    .from("project_chat_reads")
    .upsert({ project_id: projectId, user_id: user.id, last_read_at: new Date().toISOString() }, { onConflict: "project_id,user_id" });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
