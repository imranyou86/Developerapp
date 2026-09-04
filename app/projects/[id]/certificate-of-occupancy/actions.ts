"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/app/projects/actions";
import type { CertificateOfOccupancy, COClearance, COInspector, COPermit } from "@/lib/types";

export interface SaveCertificateOfOccupancyInput {
  status: string | null;
  co_number: string | null;
  issued_date: string | null;
  open_clearances: COClearance[];
  permits: COPermit[];
  inspector: COInspector | null;
  source_url: string | null;
  confidence: "high" | "medium" | "low" | null;
  notes: string | null;
}

// One row per project — "Update information" overwrites the existing check
// rather than accumulating history, so this always upserts on the unique
// project_id rather than inserting a new row each time.
export async function saveCertificateOfOccupancy(
  projectId: string,
  input: SaveCertificateOfOccupancyInput
): Promise<ActionResult & { check?: CertificateOfOccupancy }> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("certificate_of_occupancy_checks")
    .upsert({ project_id: projectId, ...input, last_checked_at: new Date().toISOString() }, { onConflict: "project_id" })
    .select("*")
    .single();
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/projects/${projectId}/certificate-of-occupancy`);
  return { ok: true, check: data as CertificateOfOccupancy };
}
