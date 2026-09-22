"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/Toast";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Modal } from "@/components/Modal";
import { sendMessage, deleteMessage, clearChat, loadMessages, markChatRead } from "@/app/projects/[id]/chat/actions";
import { createChatThread, deleteChatThread, type ThreadPickerMember } from "@/app/projects/[id]/chat/thread-actions";
import { ROLE_LABELS } from "@/lib/permissions";
import type { ChatThread, ProjectMessage, UserRole } from "@/lib/types";

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
  initialHasMore,
  isDeveloper,
  initialThreads,
  canCreateThread,
  pickerMembers,
}: {
  projectId: string;
  currentUserId: string;
  initialMessages: ProjectMessage[];
  initialHasMore: boolean;
  isDeveloper: boolean;
  initialThreads: ChatThread[];
  canCreateThread: boolean;
  pickerMembers: ThreadPickerMember[];
}) {
  const { notify } = useToast();
  const [threads, setThreads] = useState<ChatThread[]>(initialThreads);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deletingThread, setDeletingThread] = useState<ChatThread | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);

  const activeThread = threads.find((t) => t.id === activeThreadId) ?? null;

  // The general (thread_id null) chat's realtime channel also picks up new
  // threads (see chat_threads' own INSERT in the publication) so every
  // participant's sidebar updates live without a full reload — including
  // whoever the creator just added, who wasn't watching this page yet.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`project-chat-threads:${projectId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_threads", filter: `project_id=eq.${projectId}` },
        (payload) => {
          const row = payload.new as ChatThread;
          setThreads((prev) => (prev.some((t) => t.id === row.id) ? prev : [...prev, row]));
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "chat_threads", filter: `project_id=eq.${projectId}` },
        (payload) => {
          const row = payload.old as { id: string };
          setThreads((prev) => prev.filter((t) => t.id !== row.id));
          setActiveThreadId((prev) => (prev === row.id ? null : prev));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId]);

  async function handleDeleteThread() {
    if (!deletingThread) return;
    setDeletingBusy(true);
    const res = await deleteChatThread(deletingThread.id, projectId, deletingThread.title);
    setDeletingBusy(false);
    setDeletingThread(null);
    if (!res.ok) {
      notify("error", res.error ?? "Could not delete this thread.");
      return;
    }
    setThreads((prev) => prev.filter((t) => t.id !== deletingThread.id));
    setActiveThreadId((prev) => (prev === deletingThread.id ? null : prev));
    notify("success", "Thread deleted.");
  }

  return (
    <div className="flex h-[calc(100vh-220px)] min-h-[420px] flex-col gap-3 md:flex-row md:gap-4">
      {/* Horizontal scrollable strip on narrow screens (the sidebar used to
          eat most of the width on mobile, leaving the message pane a
          sliver) — a vertical sidebar again from md up. */}
      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-blueprint/10 pb-2 md:w-52 md:flex-col md:overflow-x-visible md:overflow-y-auto md:border-b-0 md:border-r md:pb-0 md:pr-3">
        <button
          className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
            activeThreadId === null ? "bg-amber/15 text-amber-dark" : "text-blueprint/70 hover:bg-concrete"
          }`}
          onClick={() => setActiveThreadId(null)}
        >
          General
        </button>
        {threads.map((t) => (
          <div key={t.id} className="group flex shrink-0 items-center gap-1">
            <button
              className={`max-w-[9rem] shrink-0 truncate whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors md:max-w-none md:flex-1 ${
                activeThreadId === t.id ? "bg-amber/15 text-amber-dark" : "text-blueprint/70 hover:bg-concrete"
              }`}
              onClick={() => setActiveThreadId(t.id)}
              title={t.title}
            >
              {t.title}
            </button>
            {(t.created_by === currentUserId || isDeveloper) && (
              <button
                className="hidden shrink-0 text-xs text-red-500 hover:underline group-hover:inline"
                onClick={() => setDeletingThread(t)}
              >
                Delete
              </button>
            )}
          </div>
        ))}
        {canCreateThread && (
          <button className="btn-ghost shrink-0 whitespace-nowrap text-xs md:mt-2" onClick={() => setCreateOpen(true)}>
            + New thread
          </button>
        )}
      </div>

      <div className="min-h-0 min-w-0 flex-1">
        <ThreadMessages
          key={activeThreadId ?? "general"}
          projectId={projectId}
          threadId={activeThreadId}
          currentUserId={currentUserId}
          isDeveloper={isDeveloper}
          initialMessages={activeThreadId === null ? initialMessages : null}
          initialHasMore={activeThreadId === null ? initialHasMore : null}
          threadTitle={activeThread?.title ?? null}
        />
      </div>

      {createOpen && (
        <CreateThreadModal
          projectId={projectId}
          members={pickerMembers}
          currentUserId={currentUserId}
          onClose={() => setCreateOpen(false)}
          onCreated={(thread) => {
            // Dedupe against the chat_threads Realtime INSERT above — that
            // event can (and often does) arrive before this callback runs,
            // since it's a separate websocket push racing the server
            // action's own HTTP response. Without this check the thread
            // got added twice: once by Realtime, once here.
            setThreads((prev) => (prev.some((t) => t.id === thread.id) ? prev : [...prev, thread]));
            setActiveThreadId(thread.id);
            setCreateOpen(false);
          }}
        />
      )}

      <ConfirmDialog
        open={!!deletingThread}
        title="Delete this thread?"
        message={`Delete "${deletingThread?.title}" and every message in it? This cannot be undone.`}
        confirmLabel="Delete"
        danger
        busy={deletingBusy}
        onCancel={() => setDeletingThread(null)}
        onConfirm={handleDeleteThread}
      />
    </div>
  );
}

function ThreadMessages({
  projectId,
  threadId,
  currentUserId,
  isDeveloper,
  initialMessages,
  initialHasMore,
  threadTitle,
}: {
  projectId: string;
  threadId: string | null;
  currentUserId: string;
  isDeveloper: boolean;
  initialMessages: ProjectMessage[] | null;
  initialHasMore: boolean | null;
  threadTitle: string | null;
}) {
  const { notify } = useToast();
  const [messages, setMessages] = useState<ProjectMessage[]>(initialMessages ?? []);
  const [hasMore, setHasMore] = useState(initialHasMore ?? false);
  const [loadingInitial, setLoadingInitial] = useState(initialMessages === null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const hasLoadedOlder = useRef(false);

  // A freshly selected thread (initialMessages null — not the SSR-loaded
  // General view) fetches its own first page on mount.
  useEffect(() => {
    if (initialMessages !== null) return;
    let cancelled = false;
    setLoadingInitial(true);
    loadMessages(projectId, threadId)
      .then(({ messages: page, hasMore: more }) => {
        if (cancelled) return;
        setMessages(page);
        setHasMore(more);
      })
      .catch((err) => notify("error", err instanceof Error ? err.message : "Could not load this thread."))
      .finally(() => {
        if (!cancelled) setLoadingInitial(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, threadId]);

  useEffect(() => {
    markChatRead(projectId, threadId ?? undefined);
  }, [projectId, threadId]);

  useEffect(() => {
    if (hasLoadedOlder.current) {
      hasLoadedOlder.current = false;
      return;
    }
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  async function handleLoadOlder() {
    if (messages.length === 0) return;
    const container = scrollRef.current;
    const previousScrollHeight = container?.scrollHeight ?? 0;

    setLoadingOlder(true);
    try {
      const { messages: older, hasMore: more } = await loadMessages(projectId, threadId, messages[0].created_at);
      hasLoadedOlder.current = true;
      setMessages((prev) => [...older, ...prev]);
      setHasMore(more);
      requestAnimationFrame(() => {
        if (container) container.scrollTop = container.scrollHeight - previousScrollHeight;
      });
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Could not load older messages.");
    } finally {
      setLoadingOlder(false);
    }
  }

  // Live updates — postgres_changes respects RLS, so this only ever
  // receives rows this user is allowed to read (a thread's own
  // participants, or any project member for General). Filtered again by
  // thread_id client-side since the subscription itself is project-wide,
  // in case this user participates in more than one thread at once.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`project-chat:${projectId}:${threadId ?? "general"}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "project_messages", filter: `project_id=eq.${projectId}` },
        (payload) => {
          const row = payload.new as ProjectMessage;
          if ((row.thread_id ?? null) !== threadId) return;
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
  }, [projectId, threadId]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;

    const id = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      { id, project_id: projectId, thread_id: threadId, user_id: currentUserId, sender_email: "", sender_name: null, body, created_at: new Date().toISOString() },
    ]);
    setDraft("");
    setSending(true);
    try {
      const res = await sendMessage(projectId, threadId, id, body);
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

  async function handleClearChat() {
    setClearing(true);
    const previous = messages;
    setMessages([]);
    const res = await clearChat(projectId);
    setClearing(false);
    setConfirmClear(false);
    if (!res.ok) {
      notify("error", res.error ?? "Could not clear the chat.");
      setMessages(previous);
      return;
    }
    notify("success", "Chat cleared.");
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="truncate text-sm font-semibold text-blueprint-dark">{threadTitle ?? "General"}</h3>
        {isDeveloper && threadId === null && messages.length > 0 && (
          <button className="text-xs text-red-500 hover:underline" onClick={() => setConfirmClear(true)}>
            Clear chat
          </button>
        )}
      </div>
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto rounded-lg border border-blueprint/10 bg-white p-4">
        {loadingInitial ? (
          <p className="text-center text-sm text-blueprint/50">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="text-center text-sm text-blueprint/50">
            {threadId === null
              ? "No messages yet — say something about this construction to get the thread going."
              : "No messages yet in this thread."}
          </p>
        ) : (
          <>
            {hasMore && (
              <div className="text-center">
                <button className="btn-ghost text-xs" onClick={handleLoadOlder} disabled={loadingOlder}>
                  {loadingOlder ? "Loading…" : "Load older messages"}
                </button>
              </div>
            )}
            {messages.map((m) => {
              const isOwn = m.user_id === currentUserId;
              return (
                <div key={m.id} className={`flex animate-fade-in-up ${isOwn ? "justify-end" : "justify-start"}`}>
                  <div className={`group max-w-[75%] rounded-lg px-3 py-2 text-sm ${isOwn ? "bg-blueprint text-white" : "bg-concrete text-blueprint-dark"}`}>
                    {!isOwn && <p className="mb-0.5 text-xs font-semibold opacity-70">{m.sender_name || m.sender_email}</p>}
                    <p className="whitespace-pre-wrap break-words">{m.body}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <span className={`text-[10px] ${isOwn ? "text-white/60" : "text-blueprint/40"}`}>{formatTimestamp(m.created_at)}</span>
                      {isOwn && (
                        <button
                          className="text-[10px] text-white/70 hover:underline"
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
            })}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSend} className="mt-3 flex gap-2">
        <input
          className="input flex-1"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={threadId === null ? "Message the team about this construction…" : `Message in "${threadTitle}"…`}
          maxLength={4000}
        />
        <button type="submit" className="btn-amber" disabled={sending || !draft.trim()}>
          Send
        </button>
      </form>

      <ConfirmDialog
        open={confirmClear}
        title="Clear this chat?"
        message="Every message in this construction's General chat will be permanently removed for everyone. This cannot be undone."
        confirmLabel="Clear chat"
        danger
        busy={clearing}
        onCancel={() => setConfirmClear(false)}
        onConfirm={handleClearChat}
      />
    </div>
  );
}

function CreateThreadModal({
  projectId,
  members,
  currentUserId,
  onClose,
  onCreated,
}: {
  projectId: string;
  members: ThreadPickerMember[];
  currentUserId: string;
  onClose: () => void;
  onCreated: (thread: ChatThread) => void;
}) {
  const { notify } = useToast();
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const pickable = members.filter((m) => m.userId !== currentUserId);

  function toggle(userId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  async function handleSave() {
    if (!title.trim()) return;
    setSaving(true);
    const res = await createChatThread(projectId, title.trim(), Array.from(selected));
    setSaving(false);
    if (!res.ok || !res.thread) {
      notify("error", res.error ?? "Could not create this thread.");
      return;
    }
    notify("success", "Thread created.");
    onCreated(res.thread);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="New chat thread"
      footer={
        <>
          <button className="btn-outline" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn-primary" disabled={saving || !title.trim()} onClick={handleSave}>
            {saving ? "Creating…" : "Create thread"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="label">Thread name</label>
          <input
            className="input"
            placeholder='e.g. "Acme Electric — rough-in"'
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            maxLength={100}
          />
          <p className="mt-1 text-xs text-blueprint/50">Name it something that&apos;ll make sense in the thread list later.</p>
        </div>

        <div>
          <label className="label">Who&apos;s in this thread</label>
          <p className="mb-2 text-xs text-blueprint/50">
            You&apos;re included automatically. Pick anyone else — typically the owner and the subcontractor account you&apos;re
            talking to.
          </p>
          {pickable.length === 0 ? (
            <p className="text-sm text-blueprint/50">No one else is on this construction yet.</p>
          ) : (
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-blueprint/10 p-2">
              {pickable.map((m) => (
                <label key={m.userId} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-concrete">
                  <input type="checkbox" checked={selected.has(m.userId)} onChange={() => toggle(m.userId)} />
                  <span className="flex-1 truncate">{m.displayName || m.email || "Unknown"}</span>
                  <span className="badge bg-blueprint/10 text-blueprint/60">{ROLE_LABELS[m.role as UserRole] ?? m.role}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
