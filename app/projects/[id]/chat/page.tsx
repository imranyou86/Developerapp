import { createClient } from "@/lib/supabase/server";
import { CHAT_PAGE_SIZE } from "@/lib/pagination";
import { ChatClient } from "@/app/projects/[id]/chat/chat-client";
import { listProjectMembersForThreadPicker } from "@/app/projects/[id]/chat/thread-actions";
import { getCurrentUser } from "@/lib/permissions-server";
import type { ChatThread, ProjectMessage } from "@/lib/types";

export const dynamic = "force-dynamic";

const CAN_CREATE_THREAD_ROLES = ["developer", "contractor", "pm"];

export default async function ChatPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const projectId = params.id;

  const [
    {
      data: { user },
    },
    currentUser,
    { data: messages, error },
    { data: threads },
  ] = await Promise.all([
    supabase.auth.getUser(),
    getCurrentUser(),
    // Most recent page only — fetched newest-first so `.limit()` keeps the
    // latest messages rather than the oldest, then reversed back to
    // ascending for display. Older history loads on demand (see
    // chat-client.tsx's "Load older messages" / loadMessages).
    supabase
      .from("project_messages")
      .select("id, project_id, user_id, sender_email, sender_name, body, created_at, thread_id")
      .eq("project_id", projectId)
      .is("thread_id", null)
      .order("created_at", { ascending: false })
      .limit(CHAT_PAGE_SIZE + 1),
    // RLS (chat_threads_select) already limits this to threads the caller
    // participates in — a Developer sees every thread on the project.
    supabase.from("chat_threads").select("id, project_id, created_by, title, created_at").eq("project_id", projectId).order("created_at"),
  ]);

  const rows = (messages ?? []) as ProjectMessage[];
  const hasMore = rows.length > CHAT_PAGE_SIZE;
  const initialMessages = (hasMore ? rows.slice(0, CHAT_PAGE_SIZE) : rows).reverse();

  const canCreateThread = !!currentUser && CAN_CREATE_THREAD_ROLES.includes(currentUser.role);
  const pickerMembers = canCreateThread ? await listProjectMembersForThreadPicker(projectId) : [];

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">Could not load chat: {error.message}</div>
      )}
      <ChatClient
        projectId={projectId}
        currentUserId={user?.id ?? ""}
        initialMessages={initialMessages}
        initialHasMore={hasMore}
        isDeveloper={currentUser?.isDeveloper ?? false}
        initialThreads={(threads ?? []) as ChatThread[]}
        canCreateThread={canCreateThread}
        pickerMembers={pickerMembers}
      />
    </div>
  );
}
