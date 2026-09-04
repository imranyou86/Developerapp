import { NextResponse } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient, CLAUDE_MODEL, extractJson, fetchImageForClaude } from "@/lib/anthropic";
import type { CostTier, QualityTier } from "@/lib/types";

const COST_TIER_BANDS: Record<CostTier, { low: number; high: number }> = {
  low: { low: 250, high: 300 },
  mid: { low: 350, high: 400 },
  high: { low: 450, high: 550 },
};

export const runtime = "nodejs";
export const maxDuration = 60;

interface PlanPageInput {
  label: string;
  url: string;
}

interface CostEstimateResult {
  total_sqft: number;
  stories: number | null;
  quality_tier: QualityTier;
  cost_tier: CostTier;
  cost_per_sqft_low: number;
  cost_per_sqft_mid: number;
  cost_per_sqft_high: number;
  predicted_cost_per_sqft: number;
  contingency_pct: number;
  prediction_confidence: "high" | "medium" | "low";
  prediction_notes: string;
  complexity_factors: string[];
  breakdown: { category: string; pct: number; description: string }[];
  reasoning: string;
}

const SYSTEM_PROMPT = `You are a professional residential construction cost estimator. You'll be
shown every sheet of an architect's plan set together (floors, elevations, site plan — whatever
was provided) and asked to produce a grounded construction cost estimate from what's actually
drawn, not a generic guess.

Your job:
1. Determine total_sqft — the total conditioned/living square footage across all floors, read
   from dimensions and room labels on the plan. Cross-reference multiple sheets if the plan spans
   floors. If a room-dimension total was provided for comparison, reconcile against it and note
   any material discrepancy in your reasoning.
2. Count stories.
3. Assess quality_tier ("economy", "standard", "premium", or "luxury") from what the plan
   actually shows or implies — room complexity, fixture counts, layout sophistication (an open
   great room with structural implications, a chef's kitchen island, multiple primary suites,
   etc. read as premium/luxury; a simple efficient layout with standard room counts reads as
   standard or economy).
4. List complexity_factors — 2-6 specific things visible in THIS plan that push cost up or down:
   roof complexity/multiple rooflines, structural spans (large open rooms, cantilevers), number
   of bathrooms (plumbing-heavy), stories and stairs, foundation type implied by site conditions,
   pools/ADUs/garages if shown, unusual room counts, site access/grading implied. Be specific to
   what you see, not generic.
5. Pick cost_tier — "low", "mid", or "high" — the pricing tier that fits the assessed quality_tier
   and complexity_factors for THIS plan, then give cost_per_sqft_low/mid/high priced within that
   tier's band:
     - low tier: $250-300/sqft (simple, efficient, economy-to-standard builds)
     - mid tier: $350-400/sqft (standard-to-premium builds with moderate complexity)
     - high tier: $450+/sqft (premium/luxury builds, high complexity, or an expensive market —
       go above $550/sqft for genuinely high-end or highly complex projects)
   Nudge the tier and the exact numbers within it up or down for the project's location if given
   (e.g. a high-cost-of-construction metro pushes toward the top of a tier or into the next one).
6. Give a breakdown — the standard cost categories (Sitework & Foundation, Framing & Structure,
   Roofing & Exterior Envelope, Windows & Doors, Plumbing, Electrical, HVAC, Interior Finishes,
   Cabinetry & Countertops, General Conditions & Permits — merge/adjust categories as sensible for
   this project) each with a pct of the total construction cost (should sum to ~100) and a short
   description of what's driving that line for this specific plan.
7. Give your single most accurate prediction, separate from the low/mid/high range above:
   - predicted_cost_per_sqft — your best single-point $/sqft estimate for THIS specific plan,
     reasoned from where exactly its complexity_factors and quality land it within (or, if truly
     warranted, just outside) the cost_tier band — not simply the midpoint of the band.
   - contingency_pct — a realistic contingency (typically 5-15%) for costs the plan can't show you:
     unknown site/soil conditions, permitting, final finish selections, change orders. Use the low
     end when the plan is detailed and site conditions look straightforward, higher when there's
     real uncertainty.
   - prediction_confidence — "high", "medium", or "low", based on how complete and legible the
     plan set is and how much is left to infer.
   - prediction_notes — 2-3 sentences on specifically what makes this plan land where it does
     within the tier, and what would most likely move the real number up or down.
8. Write reasoning — 3-5 sentences explaining the sqft read, the quality/complexity assessment,
   and anything uncertain (e.g. finish specs not shown on the plan, so quality tier is inferred
   from layout only).

Respond with ONLY a JSON object, no prose, matching this shape exactly:
{
  "total_sqft": number,
  "stories": number | null,
  "quality_tier": "economy" | "standard" | "premium" | "luxury",
  "cost_tier": "low" | "mid" | "high",
  "cost_per_sqft_low": number,
  "cost_per_sqft_mid": number,
  "cost_per_sqft_high": number,
  "predicted_cost_per_sqft": number,
  "contingency_pct": number,
  "prediction_confidence": "high" | "medium" | "low",
  "prediction_notes": string,
  "complexity_factors": string[],
  "breakdown": [ { "category": string, "pct": number, "description": string } ],
  "reasoning": string
}`;

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as {
    pages?: PlanPageInput[];
    projectAddress?: string | null;
    roomsSqftHint?: number | null;
  };
  const pages = body.pages ?? [];
  if (pages.length === 0) {
    return NextResponse.json({ error: "No plan pages to read. Upload a plan on the Plan tab first." }, { status: 400 });
  }

  try {
    const anthropic = getAnthropicClient();

    const imageBlocks = await Promise.all(
      pages.map(async (page) => {
        try {
          return { label: page.label, block: await fetchImageForClaude(page.url) };
        } catch (err) {
          throw new Error(
            `Failed to prepare plan page "${page.label}": ${err instanceof Error ? err.message : String(err)}`
          );
        }
      })
    );

    const content: Array<Anthropic.Messages.TextBlockParam | Anthropic.Messages.ImageBlockParam> = [];
    for (const { label, block } of imageBlocks) {
      content.push({ type: "text", text: `Sheet: ${label}` });
      content.push(block);
    }
    content.push({
      type: "text",
      text: [
        body.projectAddress && `Project location: ${body.projectAddress}`,
        body.roomsSqftHint && `Sum of room dimensions already entered elsewhere in this project: ${Math.round(body.roomsSqftHint).toLocaleString()} sqft (for cross-reference only)`,
        "Analyze all sheets above together and return the JSON object described in your instructions.",
      ]
        .filter(Boolean)
        .join("\n"),
    });

    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      messages: [{ role: "user", content }],
    });

    const text = message.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    if (!text.trim()) throw new Error("No text response from Claude.");

    const result = extractJson<CostEstimateResult>(text);

    // Enforce the fixed $/sqft band for whatever tier Claude picked, rather than trusting its
    // own arithmetic to stay in range — the tier's dollar bands are a product decision, not a
    // suggestion.
    const band = COST_TIER_BANDS[result.cost_tier] ?? COST_TIER_BANDS.mid;
    const clampToBand = (n: number) =>
      result.cost_tier === "high" ? Math.max(n, band.low) : Math.min(Math.max(n, band.low), band.high);
    const costPerSqftLow = clampToBand(result.cost_per_sqft_low);
    const costPerSqftMid = clampToBand(result.cost_per_sqft_mid);
    const costPerSqftHigh = clampToBand(result.cost_per_sqft_high);

    const totalCostLow = result.total_sqft * costPerSqftLow;
    const totalCostMid = result.total_sqft * costPerSqftMid;
    const totalCostHigh = result.total_sqft * costPerSqftHigh;

    // The predicted figure is allowed to land anywhere sane near the tier band (it's the "most
    // accurate single number", not a band edge) but is still guarded against a wild outlier, and
    // the contingency is capped to a believable range rather than trusted verbatim.
    const predictedCostPerSqft = Math.min(
      Math.max(result.predicted_cost_per_sqft, band.low * 0.85),
      result.cost_tier === "high" ? band.high * 1.5 : band.high * 1.15
    );
    const contingencyPct = Math.min(Math.max(result.contingency_pct, 0), 20);
    const predictedTotalCost = Math.round(result.total_sqft * predictedCostPerSqft * (1 + contingencyPct / 100));

    const breakdown = result.breakdown.map((line) => ({
      category: line.category,
      pct: line.pct,
      description: line.description,
      cost: Math.round(totalCostMid * (line.pct / 100)),
    }));

    return NextResponse.json({
      total_sqft: result.total_sqft,
      stories: result.stories,
      quality_tier: result.quality_tier,
      cost_tier: result.cost_tier,
      cost_per_sqft_low: costPerSqftLow,
      cost_per_sqft_mid: costPerSqftMid,
      cost_per_sqft_high: costPerSqftHigh,
      total_cost_low: totalCostLow,
      total_cost_mid: totalCostMid,
      total_cost_high: totalCostHigh,
      predicted_cost_per_sqft: predictedCostPerSqft,
      contingency_pct: contingencyPct,
      predicted_total_cost: predictedTotalCost,
      prediction_confidence: result.prediction_confidence,
      prediction_notes: result.prediction_notes,
      complexity_factors: result.complexity_factors,
      breakdown,
      reasoning: result.reasoning,
    });
  } catch (err) {
    console.error("estimate-construction-cost failed", err);
    const message = err instanceof Error ? err.message : "Cost estimation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
