import { createClient } from "@/lib/supabase/server";
import { CertificateOfOccupancyClient } from "@/app/projects/[id]/certificate-of-occupancy/certificate-of-occupancy-client";
import type { CertificateOfOccupancy } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function CertificateOfOccupancyPage({ params }: { params: { id: string } }) {
  const supabase = createClient();

  const [{ data: project }, { data: check }] = await Promise.all([
    supabase.from("projects").select("id, name, address").eq("id", params.id).single(),
    supabase.from("certificate_of_occupancy_checks").select("*").eq("project_id", params.id).maybeSingle(),
  ]);

  return (
    <CertificateOfOccupancyClient
      projectId={params.id}
      projectName={project?.name ?? ""}
      initialAddress={project?.address ?? null}
      initialCheck={(check as CertificateOfOccupancy | null) ?? null}
    />
  );
}
