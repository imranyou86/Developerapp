import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient, CLAUDE_MODEL, extractJson } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 30;

interface EvaluateBidRequest {
  contractor: string;
  total_amount: number;
  payment_schedule: { label: string; amount: number }[];
  address: string | null;
}

interface BidEvaluationResult {
  verdict: "good_price" | "fair_price" | "high_price";
  confidence: "high" | "medium" | "low";
  market_range_low: number | null;
  market_range_high: number | null;
  analysis: string;
}

const SYSTEM_PROMPT = `You are a construction cost consultant. Given a contractor's bid — the
contractor's name, total price, and its itemized line items — and the project's general location,
assess whether the total price is reasonable for the described scope of work in that market.

The line items may be an actual trade/material breakdown, or just payment draw stages (e.g. "50%
deposit", "Final payment on completion") with no real scope detail — in that case, infer the scope
as best you can from the contractor's name/trade and treat the bid's total as a whole rather than
pricing individual lines, and reflect that ambiguity by capping confidence at "medium" or lower.

Search the web for typical costs for the inferred scope of work in the given region — regional
remodeling/construction cost guides, contractor association data, or well-sourced cost-per-unit
figures (cost per sqft, per fixture, per linear foot, whatever fits the scope) adjusted for local
labor rates. Los Angeles/coastal California, for context if the location is there, generally runs
well above national average remodeling cost guides — account for that rather than using a
national flat figure uncritically.

Return:
- verdict: "good_price" (at or below the typical market range for this scope), "fair_price"
  (within it), or "high_price" (above it)
- confidence: "high" when the scope was clear and you found solid regional cost data; "medium" or
  "low" when the line items were vague (draw stages, not a trade breakdown), the region's cost
  data was thin, or you had to lean heavily on general national figures instead of regional ones
- market_range_low / market_range_high: your best-estimate typical total cost range in USD for
  the scope you inferred, in this specific region — null/null only if you genuinely can't infer
  enough scope to estimate anything
- analysis: 2-4 sentences — what scope you inferred and from what (line items vs. contractor
  name/trade alone), what you found searching for typical costs, how this bid's total compares,
  and any caveat about scope ambiguity or thin regional data

Be honest and specific — a wide range or "low confidence" is fine and expected when the line items
don't describe real scope. Never invent a specific market figure you didn't find or reasonably
infer from what you did find.

Respond with ONLY a JSON object, no prose, matching this shape exactly:
{ "verdict": "good_price" | "fair_price" | "high_price", "confidence": "high" | "medium" | "low", "market_range_low": number | null, "market_range_high": number | null, "analysis": string }`;

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as EvaluateBidRequest;
  if (!body.contractor || !body.total_amount) {
    return NextResponse.json({ error: "Missing contractor or total amount." }, { status: 400 });
  }

  try {
    const anthropic = getAnthropicClient();
    const query = [
      `Contractor: ${body.contractor}`,
      `Total bid amount: $${Number(body.total_amount).toLocaleString()}`,
      body.payment_schedule.length > 0
        ? `Line items:\n${body.payment_schedule.map((l) => `- ${l.label}: $${Number(l.amount).toLocaleString()}`).join("\n")}`
        : "No line items given.",
      body.address && `Project location: ${body.address}`,
    ]
      .filter(Boolean)
      .join("\n");

    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      // Basic search tool, not the sandboxed 20260209 variant — that one
      // took 60-90s+ in testing, well past a serverless function's timeout.
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
      messages: [{ role: "user", content: `Evaluate this bid:\n\n${query}` }],
    });

    const text = message.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    if (!text.trim()) throw new Error("No text response from Claude.");

    const result = extractJson<BidEvaluationResult>(text);
    return NextResponse.json(result);
  } catch (err) {
    console.error("evaluate-bid failed", err);
    const message = err instanceof Error ? err.message : "Bid evaluation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
