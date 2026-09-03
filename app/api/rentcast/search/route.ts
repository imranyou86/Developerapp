import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { searchListingsByZip } from "@/lib/rentcast";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const zipCode = new URL(req.url).searchParams.get("zip");
  if (!zipCode || !/^\d{5}$/.test(zipCode)) {
    return NextResponse.json({ error: "Provide a valid 5-digit ZIP code." }, { status: 400 });
  }

  try {
    const listings = await searchListingsByZip(zipCode, 25);
    return NextResponse.json({ listings });
  } catch (err) {
    console.error("rentcast search failed", err);
    const message = err instanceof Error ? err.message : "Listing search failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
