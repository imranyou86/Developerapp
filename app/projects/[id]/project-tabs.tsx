"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PROJECT_TABS } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/client";
import { markChatRead } from "@/app/projects/[id]/chat/actions";

export function ProjectTabs({
  projectId,
  allowedSlugs,
  currentUserId,
  initialUnreadChat,
}: {
  projectId: string;
  allowedSlugs: string[];
  currentUserId: string | null;
  initialUnreadChat: number;
}) {
  const pathname = usePathname();
  const tabs = PROJECT_TABS.filter((t) => allowedSlugs.includes(t.slug));
  const hasChat = allowedSlugs.includes("chat");
  const chatHref = `/projects/${projectId}/chat`;

  const [unreadChat, setUnreadChat] = useState(initialUnreadChat);
  // This component stays mounted across every tab within a project (it
  // lives in the shared layout, not a per-page component), so a ref is
  // enough to let the one long-lived Realtime subscription below always
  // see the current pathname without having to resubscribe every time it
  // changes.
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  // Landing directly on (or navigating client-side into) the chat tab
  // means every message up to now has just been seen — clear the badge and
  // persist that read point so it doesn't reappear on the next visit.
  useEffect(() => {
    if (!hasChat || !currentUserId || pathname !== chatHref) return;
    setUnreadChat(0);
    markChatRead(projectId);
  }, [pathname, hasChat, currentUserId, projectId, chatHref]);

  // Live badge updates for whoever isn't currently looking at chat —
  // Realtime's postgres_changes respects RLS on its own, so this only ever
  // receives rows this user's own project_messages_select policy already
  // lets them read. A message that arrives while chat IS open instead just
  // re-marks read (keeping last_read_at current) rather than incrementing,
  // so leaving and coming back doesn't recount something already seen live.
  useEffect(() => {
    if (!hasChat || !currentUserId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`project-chat-badge:${projectId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "project_messages", filter: `project_id=eq.${projectId}` },
        (payload) => {
          const row = payload.new as { user_id: string };
          if (pathnameRef.current === chatHref) {
            markChatRead(projectId);
          } else if (row.user_id !== currentUserId) {
            setUnreadChat((n) => n + 1);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId, hasChat, currentUserId, chatHref]);

  return (
    <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-6 pb-3">
      {tabs.map((tab) => {
        const href = `/projects/${projectId}/${tab.slug}`;
        const active = pathname?.startsWith(href);
        return (
          <Link
            key={tab.slug}
            href={href}
            className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 ${
              active
                ? "bg-blueprint text-white shadow-sm"
                : "text-blueprint/60 hover:bg-blueprint/5 hover:text-blueprint-dark"
            }`}
          >
            {tab.label}
            {tab.slug === "chat" && unreadChat > 0 && (
              <span className="badge-count ml-1.5" aria-label={`${unreadChat} unread message${unreadChat === 1 ? "" : "s"}`}>
                {unreadChat > 99 ? "99+" : unreadChat}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
