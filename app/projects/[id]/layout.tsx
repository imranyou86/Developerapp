import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProjectTabs } from "@/app/projects/[id]/project-tabs";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { id: string };
}) {
  const supabase = createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("id, name, address")
    .eq("id", params.id)
    .single();

  if (!project) notFound();

  return (
    <div className="min-h-screen bg-concrete">
      <header className="border-b border-blueprint/10 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-4">
          <Link href="/projects" className="text-xs text-blueprint/50 hover:text-amber">
            ← All constructions
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-blueprint-dark">{project.name}</h1>
          {project.address && <p className="text-sm text-blueprint/50">{project.address}</p>}
        </div>
        <ProjectTabs projectId={project.id} />
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
