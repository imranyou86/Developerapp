import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { enforceRateLimit } from "@/lib/rateLimit";
import { getAnthropicClient, CLAUDE_MODEL, extractJson } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 30;

interface EvaluateTradeBidRequest {
  trade: string;
  subcontractor_name: string;
  bid_amount: number;
  scope_notes: string | null;
  address: string | null;
}

interface TradeBidEvaluationResult {
  verdict: "good_price" | "fair_price" | "high_price";
  confidence: "high" | "medium" | "low";
  market_range_low: number | null;
  market_range_high: number | null;
  analysis: string;
  questions_to_ask: string[];
  scope_complete: boolean | null;
  missing_items: string[];
  completeness_note: string;
}

// Construction Cost's "Trade Bid Review" — narrower than evaluate-bid's
// whole-contract GC check: this is one subcontractor's bid for one trade,
// so the prompt leans on standard scope-of-work for that specific trade
// (what a normal electrical/plumbing/framing/etc. bid should cover) rather
// than inferring scope from payment draw stages.
const SYSTEM_PROMPT = `You are a construction cost consultant helping a homeowner or developer review a
subcontractor's bid for a single trade before signing. You're given the trade, the subcontractor's
name, their total bid amount, the project's general location, and (when provided) a description of
what the sub says is included.

Do three things:

1. PRICE — search the web for typical costs for this trade's standard scope of work in the given
   region (regional cost guides, trade association data, cost-per-unit figures — per sqft, per
   fixture, per linear foot, whatever fits the trade — adjusted for local labor rates). Los Angeles/
   coastal California, for context if the location is there, generally runs well above national
   average cost guides — account for that rather than using a flat national figure uncritically.
   Judge the bid against that range.

2. SCOPE COMPLETENESS — using your knowledge of what a complete bid for this trade normally
   includes (permits and inspections where applicable, material vs. labor, demo/haul-away/cleanup,
   fixture or equipment install, testing/commissioning, warranty on workmanship, etc.), assess
   whether the scope notes given appear to cover a complete job or leave out items a homeower would
   otherwise assume were included. If no scope notes were given at all, say so and treat
   completeness as unknown rather than guessing.

3. QUESTIONS TO ASK — write 4-6 specific, practical questions the homeowner/developer should ask
   this subcontractor before signing, grounded in THIS bid (its trade, its price relative to
   market, and any gaps in its stated scope) — not generic boilerplate. Cover things like: what
   happens if hidden conditions are found, who pulls permits, what's the warranty on labor, what's
   excluded, what's the payment schedule/timeline, license/insurance verification if not already
   confirmed.

Return:
- verdict: "good_price" (at or below typical market range for this trade/scope), "fair_price"
  (within it), or "high_price" (above it)
- confidence: "high" when the scope was clear and you found solid regional cost data; "medium" or
  "low" when scope notes were thin/missing, regional data was thin, or you leaned on national
  figures instead of regional ones
- market_range_low / market_range_high: your best-estimate typical total cost range in USD for this
  trade's scope in this region — null/null only if you genuinely can't estimate anything
- analysis: 2-4 sentences — what scope you evaluated, what you found searching for typical costs,
  how this bid compares, and any caveat about scope ambiguity or thin regional data
- questions_to_ask: array of 4-6 specific questions as described above
- scope_complete: true if the stated scope looks complete for this trade, false if it looks like it
  leaves out items a complete bid should include, null if there wasn't enough scope information to
  judge at all
- missing_items: array of specific items that seem to be missing from the stated scope (empty array
  if scope looks complete or there wasn't enough information to tell)
- completeness_note: 1-2 sentences explaining the scope_complete judgment

Be honest and specific — a wide price range, "low confidence", or "not enough information to judge
completeness" are all fine and expected when the input is thin. Never invent a specific market
figure or a missing item you didn't find or reasonably infer.

Respond with ONLY a JSON object, no prose, matching this shape exactly:
{ "verdict": "good_price" | "fair_price" | "high_price", "confidence": "high" | "medium" | "low", "market_range_low": number | null, "market_range_high": number | null, "analysis": string, "questions_to_ask": string[], "scope_complete": boolean | null, "missing_items": string[], "completeness_note": string }`;

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limited = await enforceRateLimit(user.id, "evaluate-trade-bid");
  if (limited) return limited;

  const body = (await req.json()) as EvaluateTradeBidRequest;
  if (!body.trade || !body.subcontractor_name || !body.bid_amount) {
    return NextResponse.json({ error: "Missing trade, subcontractor name, or bid amount." }, { status: 400 });
  }

  try {
    const anthropic = getAnthropicClient();
    const query = [
      `Trade: ${body.trade}`,
      `Subcontractor: ${body.subcontractor_name}`,
      `Bid amount: $${Number(body.bid_amount).toLocaleString()}`,
      body.scope_notes?.trim() ? `Scope notes (what the sub says is included):\n${body.scope_notes.trim()}` : "No scope notes given.",
      body.address && `Project location: ${body.address}`,
    ]
      .filter(Boolean)
      .join("\n");

    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      // Same reasoning as evaluate-bid: the basic search tool, not the
      // sandboxed variant — that one took 60-90s+ in testing, well past a
      // serverless function's timeout.
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
      messages: [{ role: "user", content: `Evaluate this trade bid:\n\n${query}` }],
    });

    const text = message.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    if (!text.trim()) throw new Error("No text response from Claude.");

    const result = extractJson<TradeBidEvaluationResult>(text);
    return NextResponse.json(result);
  } catch (err) {
    console.error("evaluate-trade-bid failed", err);
    const message = err instanceof Error ? err.message : "Trade bid evaluation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
