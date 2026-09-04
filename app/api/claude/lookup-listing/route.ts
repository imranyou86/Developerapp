import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient, CLAUDE_MODEL, extractJson } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 30;

interface ListingLookupResult {
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  list_price: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  lot_size: number | null;
  year_built: number | null;
  confidence: "high" | "medium" | "low";
  source: string | null;
}

// Listing sites (Zillow especially) block direct scraping/fetching of their
// pages, so this never fetches the URL itself — it's given only as text for
// Claude to read the address out of (most listing URLs encode the street
// address in the path) and as a search anchor, then web_search finds the
// current public listing details the same way lookup-property-details does
// for lot size.
const SYSTEM_PROMPT = `You are a real estate data researcher. You'll be given a real estate
listing URL (Zillow, Redfin, Realtor.com, or similar) — do NOT attempt to fetch or open that URL
directly, many listing sites block direct requests. Instead:

1. Read the property address out of the URL itself — most listing URLs encode the street address,
   city, state, and ZIP in the path (e.g. a Zillow URL like
   ".../homedetails/123-Main-St-Los-Angeles-CA-90012/12345_zpid/" tells you the address directly).
2. Use web_search with that address (and the site name, e.g. "site:zillow.com" style queries or
   just the address plus city/state) to find the current listing's price and specs from public
   sources — the listing site's own indexed page, other listing aggregators (Redfin, Realtor.com,
   Homes.com), or county assessor records for lot size/year built specifically.

Return:
- address, city, state, zip_code — parsed from the URL and/or confirmed via search
- list_price, beds, baths, sqft — from the current active listing if you can confirm it's still
  listed; null if you can't confirm current details
- lot_size — in square feet (convert from acres if needed: 1 acre = 43,560 sqft), prefer county
  assessor records
- year_built — from any reliable source
- confidence: "high" (address confirmed and current listing details found from a live source),
  "medium" (address confirmed but some fields estimated/older data), "low" (had to guess at the
  address itself, or found very little)
- source: the site(s) you found the details on, or null

Be honest — null is fine for anything you can't confidently determine. Never invent a price or
spec that isn't actually supported by what you found.

Respond with ONLY a JSON object, no prose, matching this shape exactly:
{ "address": string | null, "city": string | null, "state": string | null, "zip_code": string | null, "list_price": number | null, "beds": number | null, "baths": number | null, "sqft": number | null, "lot_size": number | null, "year_built": number | null, "confidence": "high" | "medium" | "low", "source": string | null }`;

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as { listingUrl?: string };
  if (!body.listingUrl || !body.listingUrl.trim()) {
    return NextResponse.json({ error: "No listing URL provided." }, { status: 400 });
  }

  try {
    const anthropic = getAnthropicClient();

    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      // Basic search tool, not the sandboxed 20260209 variant — that one
      // took 60-90s+ in testing, well past a serverless function's timeout.
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
      messages: [{ role: "user", content: `Listing URL: ${body.listingUrl.trim()}` }],
    });

    const text = message.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    if (!text.trim()) throw new Error("No text response from Claude.");

    const result = extractJson<ListingLookupResult>(text);
    return NextResponse.json(result);
  } catch (err) {
    console.error("lookup-listing failed", err);
    const message = err instanceof Error ? err.message : "Listing lookup failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
