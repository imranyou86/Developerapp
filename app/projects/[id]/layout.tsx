import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProjectTabs } from "@/app/projects/[id]/project-tabs";
import { ShareButton } from "@/app/projects/[id]/share-button";
import { InviteButton } from "@/app/projects/[id]/invite-button";
import { AlertSubscribeButton } from "@/app/projects/[id]/alert-subscribe-button";
import { TabAccessGuard } from "@/components/TabAccessGuard";
import { PageTransition } from "@/components/PageTransition";
import { getCurrentUser, getAllowedTabSlugs } from "@/lib/permissions-server";
import { PROJECT_TABS } from "@/lib/permissions";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { id: string };
}) {
  const supabase = createClient();
  const [{ data: project }, { data: shares }, currentUser] = await Promise.all([
    supabase.from("projects").select("id, name, address, kind").eq("id", params.id).single(),
    supabase
      .from("project_shares")
      .select("id, token, created_at, revoked_at")
      .eq("project_id", params.id)
      .is("revoked_at", null)
      .order("created_at", { ascending: false }),
    getCurrentUser(),
  ]);

  if (!project) notFound();

  const { data: alertSub } = currentUser
    ? await supabase
        .from("project_alert_subscriptions")
        .select("id")
        .eq("project_id", project.id)
        .eq("user_id", currentUser.id)
        .maybeSingle()
    : { data: null };

  const roleAllowedSlugs = currentUser ? await getAllowedTabSlugs(currentUser.role, PROJECT_TABS, currentUser.id) : [];
  // A warranty tracker skips the construction workflow entirely — every
  // role sees only Warranty Request and Chat here, regardless of what
  // tab_permissions would otherwise allow that role on a normal construction.
  const WARRANTY_TRACKER_SLUGS = ["warranty-request", "chat"];
  const allowedSlugs =
    project.kind === "warranty_tracker" ? roleAllowedSlugs.filter((slug) => WARRANTY_TRACKER_SLUGS.includes(slug)) : roleAllowedSlugs;

  // Initial unread count for the Chat tab badge — ProjectTabs (a client
  // component that stays mounted across every tab within this project)
  // keeps it live from here via Realtime and resets it once the user
  // actually visits the chat page. No project_chat_reads row yet means
  // "never read this project's chat," so every existing message counts.
  let initialUnreadChat = 0;
  if (currentUser && allowedSlugs.includes("chat")) {
    const { data: readRow } = await supabase
      .from("project_chat_reads")
      .select("last_read_at")
      .eq("project_id", project.id)
      .eq("user_id", currentUser.id)
      .maybeSingle();
    const { count } = await supabase
      .from("project_messages")
      .select("id", { count: "exact", head: true })
      .eq("project_id", project.id)
      .neq("user_id", currentUser.id)
      .gt("created_at", readRow?.last_read_at ?? "1970-01-01T00:00:00Z");
    initialUnreadChat = count ?? 0;
  }

  return (
    <div className="min-h-screen bg-concrete">
      <header className="border-b border-blueprint/10 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-start justify-between gap-y-2 px-6 py-4">
          <div className="min-w-0">
            <Link href="/projects" className="text-xs text-blueprint/50 hover:text-amber">
              ← All constructions
            </Link>
            <div className="mt-1 flex items-center gap-2">
              <h1 className="truncate text-xl font-semibold text-blueprint-dark">{project.name}</h1>
              {project.kind === "warranty_tracker" && <span className="shrink-0 badge-amber text-xs">Warranty Tracker</span>}
            </div>
            {project.address && <p className="truncate text-sm text-blueprint/50">{project.address}</p>}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {currentUser && <AlertSubscribeButton projectId={project.id} initialSubscribed={!!alertSub} />}
            {currentUser?.role === "developer" && <InviteButton projectId={project.id} />}
            <ShareButton projectId={project.id} initialShares={shares ?? []} />
          </div>
        </div>
        <ProjectTabs
          projectId={project.id}
          allowedSlugs={allowedSlugs}
          currentUserId={currentUser?.id ?? null}
          initialUnreadChat={initialUnreadChat}
        />
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <PageTransition>
          <TabAccessGuard projectId={project.id} allowedSlugs={allowedSlugs}>
            {children}
          </TabAccessGuard>
        </PageTransition>
      </main>
    </div>
  );
}
