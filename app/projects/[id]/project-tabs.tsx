"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PROJECT_TABS, PROJECT_NAV, type ProjectNavItem } from "@/lib/permissions";
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
  const hasChat = allowedSlugs.includes("chat");
  const chatHref = `/projects/${projectId}/chat`;

  const [unreadChat, setUnreadChat] = useState(initialUnreadChat);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);

  // This component stays mounted across every tab within a project (it
  // lives in the shared layout, not a per-page component), so a ref is
  // enough to let the one long-lived Realtime subscription below always
  // see the current pathname without having to resubscribe every time it
  // changes.
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
    setOpenGroup(null);
  }, [pathname]);

  // Closes an open dropdown on an outside click — the panel itself stops
  // propagation (see onClick below) so a click inside it never reaches here.
  useEffect(() => {
    if (!openGroup) return;
    function handleClick(e: MouseEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpenGroup(null);
    }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [openGroup]);

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

  const labelBySlug = new Map(PROJECT_TABS.map((t) => [t.slug, t.label]));
  const isTabActive = (slug: string) => pathname?.startsWith(`/projects/${projectId}/${slug}`);

  // Not one of PROJECT_TABS/allowedSlugs — Calendar is an ungated utility
  // view (same as the top-nav's own Calendar/Search links), just linked
  // here too with this construction pre-selected, so it's reachable
  // without leaving to the top nav and re-picking it from "All
  // constructions" every time.
  const calendarLink = (
    <Link
      key="calendar"
      href={`/calendar?project=${projectId}`}
      className="whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium text-blueprint/60 transition-all duration-200 hover:bg-blueprint/5 hover:text-blueprint-dark"
    >
      Calendar
    </Link>
  );

  function renderBadge(slug: string) {
    if (slug !== "chat" || unreadChat === 0) return null;
    return (
      <span className="badge-count ml-1.5" aria-label={`${unreadChat} unread message${unreadChat === 1 ? "" : "s"}`}>
        {unreadChat > 99 ? "99+" : unreadChat}
      </span>
    );
  }

  // Grouping into dropdowns only pays off once there's actually a lot of
  // tabs to tame (the whole point of PROJECT_NAV) — a role that only ever
  // sees a handful (e.g. a warranty-tracker project's fixed Chat +
  // Warranty Request, or a narrowly scoped role) is better served by the
  // plain flat list it always had, not an extra click to open a dropdown
  // holding just one or two things.
  const FLAT_THRESHOLD = 6;
  if (allowedSlugs.length <= FLAT_THRESHOLD) {
    return (
      <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-6 pb-3">
        {PROJECT_TABS.filter((t) => allowedSlugs.includes(t.slug)).map((t) => {
          const active = isTabActive(t.slug);
          return (
            <Link
              key={t.slug}
              href={`/projects/${projectId}/${t.slug}`}
              className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 ${
                active ? "bg-blueprint text-white shadow-sm" : "text-blueprint/60 hover:bg-blueprint/5 hover:text-blueprint-dark"
              }`}
            >
              {t.label}
              {renderBadge(t.slug)}
            </Link>
          );
        })}
        {calendarLink}
      </nav>
    );
  }

  return (
    <nav ref={navRef} className="mx-auto flex max-w-6xl flex-wrap items-center gap-1 px-6 pb-3">
      {PROJECT_NAV.map((item: ProjectNavItem) => {
        if (item.type === "tab") {
          if (!allowedSlugs.includes(item.slug)) return null;
          const href = `/projects/${projectId}/${item.slug}`;
          const active = isTabActive(item.slug);
          return (
            <Link
              key={item.slug}
              href={href}
              className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 ${
                active ? "bg-blueprint text-white shadow-sm" : "text-blueprint/60 hover:bg-blueprint/5 hover:text-blueprint-dark"
              }`}
            >
              {item.label}
              {renderBadge(item.slug)}
            </Link>
          );
        }

        const visibleSlugs = item.slugs.filter((slug) => allowedSlugs.includes(slug));
        if (visibleSlugs.length === 0) return null;
        // A group with exactly one visible tab (the rest hidden by this
        // role's tab_permissions) isn't worth a dropdown — just link to it
        // directly, same as an ungrouped tab.
        if (visibleSlugs.length === 1) {
          const slug = visibleSlugs[0];
          const href = `/projects/${projectId}/${slug}`;
          const active = isTabActive(slug);
          return (
            <Link
              key={item.label}
              href={href}
              className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 ${
                active ? "bg-blueprint text-white shadow-sm" : "text-blueprint/60 hover:bg-blueprint/5 hover:text-blueprint-dark"
              }`}
            >
              {labelBySlug.get(slug)}
              {renderBadge(slug)}
            </Link>
          );
        }

        const groupActive = visibleSlugs.some(isTabActive);
        const isOpen = openGroup === item.label;
        const showChatBadge = visibleSlugs.includes("chat") && unreadChat > 0;

        return (
          <div key={item.label} className="relative">
            <button
              type="button"
              onClick={() => setOpenGroup(isOpen ? null : item.label)}
              className={`flex items-center gap-1 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 ${
                groupActive ? "bg-blueprint text-white shadow-sm" : "text-blueprint/60 hover:bg-blueprint/5 hover:text-blueprint-dark"
              }`}
            >
              {item.label}
              {showChatBadge && (
                <span className="badge-count" aria-label={`${unreadChat} unread message${unreadChat === 1 ? "" : "s"}`}>
                  {unreadChat > 99 ? "99+" : unreadChat}
                </span>
              )}
              <span className={`text-xs transition-transform ${isOpen ? "rotate-180" : ""}`}>▾</span>
            </button>
            {isOpen && (
              <div
                className="animate-fade-in absolute left-0 top-full z-20 mt-1 min-w-[10rem] rounded-lg border border-blueprint/10 bg-white py-1 shadow-elevated"
                onClick={(e) => e.stopPropagation()}
              >
                {visibleSlugs.map((slug) => {
                  const active = isTabActive(slug);
                  return (
                    <Link
                      key={slug}
                      href={`/projects/${projectId}/${slug}`}
                      className={`flex items-center justify-between px-3 py-2 text-sm transition-colors ${
                        active ? "bg-blueprint/10 font-medium text-blueprint-dark" : "text-blueprint/70 hover:bg-concrete hover:text-blueprint-dark"
                      }`}
                    >
                      {labelBySlug.get(slug)}
                      {renderBadge(slug)}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      {calendarLink}
    </nav>
  );
}
