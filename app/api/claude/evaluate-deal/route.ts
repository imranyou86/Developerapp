import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient, CLAUDE_MODEL, extractJson } from "@/lib/anthropic";
import { getValueEstimate } from "@/lib/rentcast";
import type { DealComp, DealScope, DealVerdict } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

interface EvaluateDealRequest {
  address: string;
  city: string | null;
  state: string | null;
  zipCode: string;
  listPrice: number | null;
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  yearBuilt: number | null;
  scope: DealScope;
  scopeDescription: string;
  costPerSqft: number;
  constructionBudget: number;
}

interface ArvResult {
  arv_estimate: number;
  arv_low: number;
  arv_high: number;
  comps: DealComp[];
  reasoning: string;
}

const SYSTEM_PROMPT = `You are a real estate investment analyst. You evaluate whether a property is
worth buying to renovate or rebuild, by estimating its ARV — the After-Repair/Rebuild Value it
would sell for once the described construction work is complete.

You'll be given the property's listing details, an automated value estimate and any comparable
sales already available, and a description of the planned construction scope and budget. Search
the web for additional comparable sales in the same area — prioritize recently sold homes that
are already renovated, remodeled, or newly built, since those are the best comps for an ARV
estimate (not other as-is fixer-uppers).

Return:
- arv_estimate: your best point estimate of the completed home's value, in USD
- arv_low / arv_high: a reasonable range around that estimate
- comps: up to 6 comparable sales you found or were given, each with: address, sold_price
  (number or null), sold_date (string or null), sqft (number or null), distance_miles (number or
  null), source ("rentcast" if it came from the provided data, "web_search" if you found it),
  and url (string or null)
- reasoning: 3-5 sentences citing specific comps, noting neighborhood price trends, and flagging
  real risk factors (permitting/entitlement risk, market softening, over-improving for the
  neighborhood ceiling, etc.) — be honest and specific, not generically optimistic

Respond with ONLY a JSON object, no prose, matching this shape exactly:
{ "arv_estimate": number, "arv_low": number, "arv_high": number, "comps": [ { "address": string, "sold_price": number | null, "sold_date": string | null, "sqft": number | null, "distance_miles": number | null, "source": "rentcast" | "web_search", "url": string | null } ], "reasoning": string }`;

function computeVerdict(profitMarginPct: number): DealVerdict {
  if (profitMarginPct >= 20) return "good_deal";
  if (profitMarginPct >= 5) return "marginal";
  return "pass";
}

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as EvaluateDealRequest;
  if (!body.address || !body.constructionBudget) {
    return NextResponse.json({ error: "Missing address or construction budget." }, { status: 400 });
  }

  try {
    // Best-effort — an address RentCast can't resolve shouldn't block the
    // whole evaluation, since web search can still ground an ARV estimate.
    let currentValueEstimate: number | null = null;
    let rentcastComps: DealComp[] = [];
    try {
      const avm = await getValueEstimate(body.address);
      currentValueEstimate = avm.price;
      rentcastComps = avm.comparables.slice(0, 6).map((c) => ({
        address: c.formattedAddress ?? "Unknown address",
        sold_price: c.price ?? null,
        sold_date: c.removedDate ?? c.listedDate ?? null,
        sqft: c.squareFootage ?? null,
        distance_miles: c.distance ?? null,
        source: "rentcast",
        url: null,
      }));
    } catch (avmErr) {
      console.warn("RentCast AVM lookup failed, continuing without it:", avmErr);
    }

    const anthropic = getAnthropicClient();
    const query = [
      `Address: ${body.address}, ${body.city ?? ""} ${body.state ?? ""} ${body.zipCode}`.trim(),
      body.listPrice && `List price: $${body.listPrice.toLocaleString()}`,
      body.sqft && `Size: ${body.sqft.toLocaleString()} sqft`,
      body.beds && `Bedrooms: ${body.beds}`,
      body.baths && `Bathrooms: ${body.baths}`,
      body.yearBuilt && `Year built: ${body.yearBuilt}`,
      `Planned scope: ${body.scope === "ground_up" ? "full ground-up rebuild" : "remodel"} — ${body.scopeDescription}`,
      `Construction budget: $${body.constructionBudget.toLocaleString()} (at $${body.costPerSqft}/sqft)`,
      currentValueEstimate && `Current as-is automated value estimate: $${currentValueEstimate.toLocaleString()}`,
      rentcastComps.length > 0 &&
        `Known comparable sales:\n${rentcastComps.map((c) => `- ${c.address}: ${c.sold_price ? `$${c.sold_price.toLocaleString()}` : "price unknown"}${c.sqft ? `, ${c.sqft} sqft` : ""}`).join("\n")}`,
    ]
      .filter(Boolean)
      .join("\n");

    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      // Basic search tool (not the sandboxed 20260209 variant) — that one
      // took 60-90s+ in testing, well past a serverless function's timeout.
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }],
      messages: [{ role: "user", content: `Evaluate this property:\n\n${query}` }],
    });

    const text = message.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    if (!text.trim()) throw new Error("No text response from Claude.");

    const arv = extractJson<ArvResult>(text);

    const totalCost = (body.listPrice ?? 0) + body.constructionBudget;
    const estimatedProfit = arv.arv_estimate - totalCost;
    const profitMarginPct = totalCost > 0 ? (estimatedProfit / totalCost) * 100 : 0;
    const verdict = computeVerdict(profitMarginPct);

    // Merge RentCast comps (already fetched) ahead of whatever Claude cites,
    // deduping by address.
    const seen = new Set(rentcastComps.map((c) => c.address.toLowerCase()));
    const mergedComps = [
      ...rentcastComps,
      ...arv.comps.filter((c) => !seen.has(c.address.toLowerCase())),
    ].slice(0, 8);

    return NextResponse.json({
      current_value_estimate: currentValueEstimate,
      arv_estimate: arv.arv_estimate,
      arv_low: arv.arv_low,
      arv_high: arv.arv_high,
      total_cost: totalCost,
      estimated_profit: estimatedProfit,
      profit_margin_pct: profitMarginPct,
      verdict,
      reasoning: arv.reasoning,
      comps: mergedComps,
    });
  } catch (err) {
    console.error("evaluate-deal failed", err);
    const message = err instanceof Error ? err.message : "Deal evaluation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
