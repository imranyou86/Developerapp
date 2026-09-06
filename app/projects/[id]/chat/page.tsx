import { createClient } from "@/lib/supabase/server";
import { ChatClient } from "@/app/projects/[id]/chat/chat-client";
import type { ProjectMessage } from "@/lib/types";

export const dynamic = "force-dynamic";

// Last 200 messages — plenty for an active job-site chat without needing
// pagination; older history is still in the database if that ever changes.
const MESSAGE_LIMIT = 200;

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
    supabase
      .from("project_messages")
      .select("id, project_id, user_id, sender_email, body, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true })
      .limit(MESSAGE_LIMIT),
  ]);

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">Could not load chat: {error.message}</div>
      )}
      <ChatClient projectId={projectId} currentUserId={user?.id ?? ""} initialMessages={(messages ?? []) as ProjectMessage[]} />
    </div>
  );
}
