"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createProject, type ActionResult } from "@/app/projects/actions";
import type { RentcastListing } from "@/lib/rentcast";
import type { DealStatus } from "@/lib/types";

export async function saveDeal(listing: RentcastListing): Promise<ActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const address = listing.addressLine1 ?? listing.formattedAddress;
  if (!address) return { ok: false, error: "Listing has no address." };

  const { data, error } = await supabase
    .from("deals")
    .insert({
      user_id: user.id,
      address,
      city: listing.city ?? null,
      state: listing.state ?? null,
      zip_code: listing.zipCode ?? "",
      list_price: listing.price ?? null,
      beds: listing.bedrooms ?? null,
      baths: listing.bathrooms ?? null,
      sqft: listing.squareFootage ?? null,
      lot_size: listing.lotSize ?? null,
      year_built: listing.yearBuilt ?? null,
      raw_listing: listing,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };
  revalidatePath("/deals");
  return { ok: true, id: data.id };
}

export interface ManualDealInput {
  address: string;
  city: string;
  state: string;
  zip_code: string;
  list_price: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  lot_size: number | null;
  year_built: number | null;
  listing_url: string | null;
}

export async function saveManualDeal(input: ManualDealInput): Promise<ActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };
  if (!input.address.trim()) return { ok: false, error: "Address is required." };
  if (!/^\d{5}$/.test(input.zip_code)) return { ok: false, error: "Enter a valid 5-digit ZIP code." };

  const { data, error } = await supabase
    .from("deals")
    .insert({
      user_id: user.id,
      address: input.address.trim(),
      city: input.city.trim() || null,
      state: input.state.trim() || null,
      zip_code: input.zip_code,
      list_price: input.list_price,
      beds: input.beds,
      baths: input.baths,
      sqft: input.sqft,
      lot_size: input.lot_size,
      year_built: input.year_built,
      listing_url: input.listing_url,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };
  revalidatePath("/deals");
  return { ok: true, id: data.id };
}

export async function updateDealZoning(
  dealId: string,
  input: { lot_size: number | null; zone: string | null; lot_coverage_pct: number | null }
): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase
    .from("deals")
    .update({ lot_size: input.lot_size, zone: input.zone, lot_coverage_pct: input.lot_coverage_pct })
    .eq("id", dealId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/deals/${dealId}`);
  return { ok: true };
}

export async function deleteDeal(dealId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("deals").delete().eq("id", dealId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/deals");
  return { ok: true };
}

export async function updateDealStatus(dealId: string, status: DealStatus): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("deals").update({ status }).eq("id", dealId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/deals");
  revalidatePath(`/deals/${dealId}`);
  return { ok: true };
}

export async function convertDealToProject(dealId: string, address: string): Promise<ActionResult> {
  const supabase = createClient();

  const projectRes = await createProject(address, address);
  if (!projectRes.ok || !projectRes.id) {
    return { ok: false, error: projectRes.error ?? "Could not create construction." };
  }

  const { error } = await supabase
    .from("deals")
    .update({ status: "converted", project_id: projectRes.id })
    .eq("id", dealId);

  if (error) {
    return { ok: false, error: `Construction created, but the deal wasn't linked: ${error.message}` };
  }

  revalidatePath("/deals");
  revalidatePath(`/deals/${dealId}`);
  return { ok: true, id: projectRes.id };
}
