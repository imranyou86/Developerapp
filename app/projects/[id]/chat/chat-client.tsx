"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/Toast";
import { sendMessage, deleteMessage } from "@/app/projects/[id]/chat/actions";
import type { ProjectMessage } from "@/lib/types";

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  const isToday = date.toDateString() === new Date().toDateString();
  return isToday
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function ChatClient({
  projectId,
  currentUserId,
  initialMessages,
}: {
  projectId: string;
  currentUserId: string;
  initialMessages: ProjectMessage[];
}) {
  const { notify } = useToast();
  const [messages, setMessages] = useState<ProjectMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  // Live updates for every viewer of this project's chat — Realtime's
  // postgres_changes respects RLS on its own, so this only ever receives
  // rows project_messages_select would let this user read anyway. Dedupes
  // by id: the sender's own optimistic entry (added in handleSend, below)
  // already has the exact id this INSERT event carries, so it's just
  // ignored rather than appended a second time.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`project-chat:${projectId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "project_messages", filter: `project_id=eq.${projectId}` },
        (payload) => {
          const row = payload.new as ProjectMessage;
          setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "project_messages", filter: `project_id=eq.${projectId}` },
        (payload) => {
          const row = payload.old as { id: string };
          setMessages((prev) => prev.filter((m) => m.id !== row.id));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;

    const id = crypto.randomUUID();
    // Optimistic — appended immediately so sending feels instant; the
    // Realtime INSERT event for this exact id arrives shortly after and is
    // a no-op against this same entry (see the dedupe above).
    setMessages((prev) => [
      ...prev,
      { id, project_id: projectId, user_id: currentUserId, sender_email: "", body, created_at: new Date().toISOString() },
    ]);
    setDraft("");
    setSending(true);
    try {
      const res = await sendMessage(projectId, id, body);
      if (!res.ok) {
        notify("error", res.error ?? "Could not send message.");
        setMessages((prev) => prev.filter((m) => m.id !== id));
      }
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Could not send message.");
      setMessages((prev) => prev.filter((m) => m.id !== id));
    } finally {
      setSending(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    const previous = messages;
    setMessages((prev) => prev.filter((m) => m.id !== id));
    const res = await deleteMessage(id);
    if (!res.ok) {
      notify("error", res.error ?? "Could not delete message.");
      setMessages(previous);
    }
    setDeletingId(null);
  }

  return (
    <div className="flex h-[calc(100vh-220px)] min-h-[420px] flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto rounded-lg border border-blueprint/10 bg-white p-4">
        {messages.length === 0 ? (
          <p className="text-center text-sm text-blueprint/50">
            No messages yet — say something about this construction to get the thread going.
          </p>
        ) : (
          messages.map((m) => {
            const isOwn = m.user_id === currentUserId;
            return (
              <div key={m.id} className={`flex ${isOwn ? "justify-end" : "justify-start"}`}>
                <div className={`group max-w-[75%] rounded-lg px-3 py-2 text-sm ${isOwn ? "bg-blueprint text-white" : "bg-concrete text-blueprint-dark"}`}>
                  {!isOwn && <p className="mb-0.5 text-xs font-semibold opacity-70">{m.sender_email}</p>}
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <span className={`text-[10px] ${isOwn ? "text-white/60" : "text-blueprint/40"}`}>{formatTimestamp(m.created_at)}</span>
                    {isOwn && (
                      <button
                        className={`text-[10px] opacity-0 hover:underline group-hover:opacity-100 ${isOwn ? "text-white/70" : "text-blueprint/50"}`}
                        onClick={() => handleDelete(m.id)}
                        disabled={deletingId === m.id}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSend} className="mt-3 flex gap-2">
        <input
          className="input flex-1"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message the team about this construction…"
          maxLength={4000}
        />
        <button type="submit" className="btn-amber" disabled={sending || !draft.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
