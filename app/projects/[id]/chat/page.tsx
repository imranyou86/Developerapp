import { createClient } from "@/lib/supabase/server";
import { CHAT_PAGE_SIZE } from "@/lib/pagination";
import { ChatClient } from "@/app/projects/[id]/chat/chat-client";
import type { ProjectMessage } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ChatPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const projectId = params.id;

  const [
    {
      data: { user },
    },
    { data: messages, error },
  ] = await Promise.all([
    supabase.auth.getUser(),
    // Most recent page only — fetched newest-first so `.limit()` keeps the
    // latest messages rather than the oldest, then reversed back to
    // ascending for display. Older history loads on demand (see
    // chat-client.tsx's "Load older messages" / loadOlderMessages).
    supabase
      .from("project_messages")
      .select("id, project_id, user_id, sender_email, body, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(CHAT_PAGE_SIZE + 1),
  ]);

  const rows = (messages ?? []) as ProjectMessage[];
  const hasMore = rows.length > CHAT_PAGE_SIZE;
  const initialMessages = (hasMore ? rows.slice(0, CHAT_PAGE_SIZE) : rows).reverse();

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">Could not load chat: {error.message}</div>
      )}
      <ChatClient projectId={projectId} currentUserId={user?.id ?? ""} initialMessages={initialMessages} initialHasMore={hasMore} />
    </div>
  );
}
