import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProjectTabs } from "@/app/projects/[id]/project-tabs";
import { ShareButton } from "@/app/projects/[id]/share-button";
import { InviteButton } from "@/app/projects/[id]/invite-button";
import { TabAccessGuard } from "@/components/TabAccessGuard";
import { getCurrentUser, getAllowedTabSlugs } from "@/lib/permissions-server";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { id: string };
}) {
  const supabase = createClient();
  const [{ data: project }, { data: shares }, currentUser] = await Promise.all([
    supabase.from("projects").select("id, name, address").eq("id", params.id).single(),
    supabase
      .from("project_shares")
      .select("id, token, created_at, revoked_at")
      .eq("project_id", params.id)
      .is("revoked_at", null)
      .order("created_at", { ascending: false }),
    getCurrentUser(),
  ]);

  if (!project) notFound();

  const allowedSlugs = currentUser ? await getAllowedTabSlugs(currentUser.role) : [];

  return (
    <div className="min-h-screen bg-concrete">
      <header className="border-b border-blueprint/10 bg-white">
        <div className="mx-auto flex max-w-6xl items-start justify-between px-6 py-4">
          <div>
            <Link href="/projects" className="text-xs text-blueprint/50 hover:text-amber">
              ← All constructions
            </Link>
            <h1 className="mt-1 text-xl font-semibold text-blueprint-dark">{project.name}</h1>
            {project.address && <p className="text-sm text-blueprint/50">{project.address}</p>}
          </div>
          <div className="flex shrink-0 gap-2">
            {currentUser?.role === "developer" && <InviteButton projectId={project.id} />}
            <ShareButton projectId={project.id} initialShares={shares ?? []} />
          </div>
        </div>
        <ProjectTabs projectId={project.id} allowedSlugs={allowedSlugs} />
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <TabAccessGuard projectId={project.id} allowedSlugs={allowedSlugs}>
          {children}
        </TabAccessGuard>
      </main>
    </div>
  );
}
