"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logActivity } from "@/lib/activityLog";
import type { ActionResult } from "@/app/projects/actions";
import type { ChatThread } from "@/lib/types";

function revalidate(projectId: string) {
  revalidatePath(`/projects/${projectId}/chat`);
}

// Mirrors can_create_chat_thread()'s RLS check (Developer/Contractor/PM +
// has_project_access) so a disallowed attempt gets a clear message instead
// of a raw Postgres RLS error.
async function requireThreadCreator(projectId: string): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (!profile || !["developer", "contractor", "pm"].includes(profile.role)) {
    return { ok: false, error: "Only a Developer, Contractor, or PM can start a chat thread." };
  }

  const { data: membership } = await supabase
    .from("project_members")
    .select("id")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();
  const { data: project } = await supabase.from("projects").select("id").eq("id", projectId).eq("user_id", user.id).maybeSingle();
  if (profile.role !== "developer" && !membership && !project) {
    return { ok: false, error: "You don't have access to this construction." };
  }

  return { ok: true, userId: user.id };
}

export interface ThreadPickerMember {
  userId: string;
  role: string;
  email: string | null;
  displayName: string | null;
}

// Every account on this construction (Owner included), for the "+ New
// thread" picker — resolved via the admin client since profiles_select
// only lets a caller read their own row, and a Contractor/PM (not just a
// Developer) needs to see teammates' names/emails to pick who goes in a
// thread. Gated the same as thread creation itself: only reachable by
// someone who could create a thread on this project anyway.
export async function listProjectMembersForThreadPicker(projectId: string): Promise<ThreadPickerMember[]> {
  const auth = await requireThreadCreator(projectId);
  if (!auth.ok) return [];

  const supabase = createClient();
  const admin = createAdminClient();

  const [{ data: members }, { data: project }] = await Promise.all([
    supabase.from("project_members").select("user_id, role").eq("project_id", projectId),
    supabase.from("projects").select("user_id").eq("id", projectId).maybeSingle(),
  ]);

  const rows = (members ?? []).map((m) => ({ userId: m.user_id, role: m.role as string }));
  // The construction's own creator isn't necessarily a project_members row
  // (see has_project_access) — include them too, labeled by their real
  // role, so a Developer who created the project without adding
  // themselves as a member still shows up as a pickable participant.
  if (project?.user_id && !rows.some((r) => r.userId === project.user_id)) {
    rows.push({ userId: project.user_id, role: "developer" });
  }

  if (rows.length === 0) return [];
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, email, display_name")
    .in(
      "id",
      rows.map((r) => r.userId)
    );
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

  return rows.map((r) => ({
    userId: r.userId,
    role: r.role,
    email: profileById.get(r.userId)?.email ?? null,
    displayName: profileById.get(r.userId)?.display_name ?? null,
  }));
}

export async function createChatThread(
  projectId: string,
  title: string,
  participantUserIds: string[]
): Promise<ActionResult & { thread?: ChatThread }> {
  const auth = await requireThreadCreator(projectId);
  if (!auth.ok) return { ok: false, error: auth.error };

  const trimmedTitle = title.trim();
  if (!trimmedTitle) return { ok: false, error: "Give this thread a name." };

  const supabase = createClient();
  const { data: thread, error } = await supabase
    .from("chat_threads")
    .insert({ project_id: projectId, created_by: auth.userId, title: trimmedTitle })
    .select("id, project_id, created_by, title, created_at")
    .single();
  if (error) return { ok: false, error: error.message };

  // Always include the creator, even if they left themselves out of the
  // picker — a thread they can't read back would be a confusing dead end.
  const participantIds = Array.from(new Set([auth.userId, ...participantUserIds]));
  const { error: participantsError } = await supabase
    .from("chat_thread_participants")
    .insert(participantIds.map((userId) => ({ thread_id: thread.id, user_id: userId })));
  if (participantsError) {
    await supabase.from("chat_threads").delete().eq("id", thread.id);
    return { ok: false, error: participantsError.message };
  }

  await logActivity(supabase, {
    projectId,
    userId: auth.userId,
    action: "chat_thread.created",
    entityType: "chat_threads",
    entityId: thread.id,
    detail: `Started a chat thread: "${trimmedTitle}"`,
  });

  revalidate(projectId);
  return { ok: true, id: thread.id, thread: thread as ChatThread };
}

export async function deleteChatThread(threadId: string, projectId: string, title?: string): Promise<ActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase.from("chat_threads").delete().eq("id", threadId);
  if (error) return { ok: false, error: error.message };

  await logActivity(supabase, {
    projectId,
    userId: user.id,
    action: "chat_thread.deleted",
    entityType: "chat_threads",
    entityId: threadId,
    detail: title ? `Deleted the chat thread "${title}"` : "Deleted a chat thread",
  });

  revalidate(projectId);
  return { ok: true };
}
