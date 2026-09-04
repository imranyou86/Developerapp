"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/app/projects/actions";
import type { Subcontractor } from "@/lib/types";

const SELECT_COLUMNS =
  "id, created_by, company_name, contact_name, trade, phone, email, address, license_number, license_state, reliability, cost_tier, notes, created_at";

export interface SubcontractorInput {
  company_name: string;
  contact_name: string;
  trade: string;
  phone: string;
  email: string;
  address: string;
  license_number: string;
  license_state: string;
  reliability: number | null;
  cost_tier: number | null;
  notes: string;
}

function toRow(input: SubcontractorInput) {
  return {
    company_name: input.company_name.trim(),
    contact_name: input.contact_name.trim() || null,
    trade: input.trade.trim() || null,
    phone: input.phone.trim() || null,
    email: input.email.trim() || null,
    address: input.address.trim() || null,
    license_number: input.license_number.trim() || null,
    license_state: input.license_state.trim() || null,
    reliability: input.reliability,
    cost_tier: input.cost_tier,
    notes: input.notes.trim() || null,
  };
}

export async function createSubcontractor(
  input: SubcontractorInput
): Promise<ActionResult & { subcontractor?: Subcontractor }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };
  if (!input.company_name.trim()) return { ok: false, error: "Company name is required." };

  const { data, error } = await supabase
    .from("subcontractors")
    .insert({ ...toRow(input), created_by: user.id })
    .select(SELECT_COLUMNS)
    .single();
  if (error) return { ok: false, error: error.message };

  revalidatePath("/subcontractors");
  return { ok: true, id: data.id, subcontractor: data as Subcontractor };
}

export async function updateSubcontractor(
  id: string,
  input: SubcontractorInput
): Promise<ActionResult & { subcontractor?: Subcontractor }> {
  const supabase = createClient();
  if (!input.company_name.trim()) return { ok: false, error: "Company name is required." };

  // RLS (subcontractors_update) already restricts this to the row's
  // creator or a Developer — a mismatch just updates 0 rows (and .single()
  // below turns that into a clear "not found" error) rather than silently
  // no-op'ing, so there's nothing extra to check here.
  const { data, error } = await supabase.from("subcontractors").update(toRow(input)).eq("id", id).select(SELECT_COLUMNS).single();
  if (error) return { ok: false, error: error.message };

  revalidatePath("/subcontractors");
  return { ok: true, subcontractor: data as Subcontractor };
}

export async function deleteSubcontractor(id: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("subcontractors").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/subcontractors");
  return { ok: true };
}
