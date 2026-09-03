import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient, CLAUDE_MODEL, extractJson } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 30;

interface PropertyDetailsResult {
  lot_size: number | null;
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  year_built: number | null;
  source: string | null;
  confidence: "high" | "medium" | "low";
}

const SYSTEM_PROMPT = `You are a real estate data researcher. Given a property address, search the
web to find its actual recorded details — lot size is the priority, but also confirm living area
sqft, bedrooms, bathrooms, and year built if you can.

Prefer authoritative sources in this order: county assessor/property records, then major listing
sites (Zillow, Redfin, Realtor.com). Lot size should be in square feet — if a source gives acres,
convert (1 acre = 43,560 sqft).

Return:
- lot_size: lot size in square feet, or null if you can't find it
- sqft: living area square footage, or null
- beds / baths: or null
- year_built: or null
- source: the name of the site/source you got the lot size from (e.g. "Zillow", "LA County
  Assessor"), or null if lot_size is null
- confidence: "high" (an authoritative source gave an exact figure), "medium" (a listing site
  figure, or minor inconsistency between sources), "low" (had to estimate or sources disagreed
  significantly)

Be honest — null is fine if you can't find a real figure. Don't invent one.

Respond with ONLY a JSON object, no prose, matching this shape exactly:
{ "lot_size": number | null, "sqft": number | null, "beds": number | null, "baths": number | null, "year_built": number | null, "source": string | null, "confidence": "high" | "medium" | "low" }`;

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as {
    address?: string;
    city?: string | null;
    state?: string | null;
    zipCode?: string;
  };
  if (!body.address) {
    return NextResponse.json({ error: "No address provided." }, { status: 400 });
  }

  try {
    const anthropic = getAnthropicClient();
    const query = `${body.address}, ${body.city ?? ""} ${body.state ?? ""} ${body.zipCode ?? ""}`.trim();

    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      // Basic search tool, not the sandboxed 20260209 variant — that one
      // took 60-90s+ in testing, well past a serverless function's timeout.
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
      messages: [{ role: "user", content: `Find the recorded property details for: ${query}` }],
    });

    const text = message.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    if (!text.trim()) throw new Error("No text response from Claude.");

    const result = extractJson<PropertyDetailsResult>(text);
    return NextResponse.json(result);
  } catch (err) {
    console.error("lookup-property-details failed", err);
    const message = err instanceof Error ? err.message : "Property lookup failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
