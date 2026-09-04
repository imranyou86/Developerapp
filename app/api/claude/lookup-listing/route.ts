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
2. ALWAYS run at least two web_search queries with different phrasing for that address before
   answering — e.g. "<address> zillow" AND "<address> redfin" (or "<address> for sale" / "<address>
   real estate"). Do this even if the first search already seems to answer the question — a single
   search result is not enough to trust here. Someone pasted this URL because they're evaluating
   buying this property, so finding an accurate, current price is the most important part of this
   task.
   Search results and cached listing pages can be stale — a home's price frequently drops (or the
   listing goes pending/off-market) after a page was last indexed, and different sites can show
   different, conflicting figures (an active asking price vs. an automated "Zestimate"-style value
   estimate vs. an old sale price are three different numbers — don't conflate them). Actively
   check for signals of a more recent price: "price cut"/"price reduced" mentions, a more
   recently-dated result, or a different figure on a second source. If sources disagree, prefer an
   actual listed asking price over an automated value estimate, and whichever is dated most
   recently or explicitly flagged as current. Don't just take the first number you see, and don't
   conclude "not currently listed" from a single search that happened not to surface a price —
   search again before ruling that out.
   If two or more credible sources give meaningfully different prices for the same address and you
   can't tell which is actually current (this happens — one source can lag another by weeks), do
   NOT silently pick one and call it "medium" confidence. Instead: still return your best-guess
   price (never leave it blank when you found real numbers), but set confidence to "low" and put
   ALL the figures you found in source, clearly labeled by site, so the person reviewing this can
   see the disagreement and check the actual listing themselves rather than trusting a guess.
3. Also search for beds/baths/sqft/lot_size/year_built from the listing site's own indexed page,
   other aggregators (Redfin, Realtor.com, Homes.com), or county assessor records (best for lot
   size/year built specifically).

Return:
- address, city, state, zip_code — parsed from the URL and/or confirmed via search
- list_price — the current asking price if actively listed, preferring the most recent/current
  figure per the staleness guidance above. If search results show the listing as recently
  sold/pending/off-market instead, still return that last known asking (or sale) price and say so
  in source/confidence — a recent figure is far more useful for evaluating this deal than a blank
  field. Only use null if you genuinely find no price for this address after searching more than
  once.
- beds, baths, sqft — from whatever listing data you found
- lot_size — in square feet (convert from acres if needed: 1 acre = 43,560 sqft), prefer county
  assessor records
- year_built — from any reliable source
- confidence: "high" (address confirmed and current listing details found from a live source, with
  no conflicting price seen), "medium" (address confirmed but some fields estimated/older data, or
  the listing is pending/sold so the price is a last-known figure), "low" (had to guess at the
  address itself, found very little, OR sources gave meaningfully different prices you couldn't
  reconcile — see the disagreement rule above)
- source: the site(s) you found the details on, or null

Be honest about what you found and its recency, but don't default to null just because you're not
100% certain a listing is still active — a recently-known price with a note beats a blank field.
Never invent a number that isn't actually supported by what you found.

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
      // Medium, not low, effort here — unlike this app's other web-search
      // routes, price accuracy matters more than shaving a few seconds, and
      // "low" effort was concluding "not listed" off a single search that
      // didn't happen to surface a price. Testing showed 6-13s even at low
      // effort with several searches, well under this route's 30s budget.
      output_config: { effort: "medium" },
      // Basic search tool, not the sandboxed 20260209 variant — that one
      // took 60-90s+ in testing, well past a serverless function's timeout.
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
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
