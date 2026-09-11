import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { enforceRateLimit } from "@/lib/rateLimit";
import { getAnthropicClient, CLAUDE_MODEL, extractJson } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 30;

interface ZoningCoverageResult {
  buildable_pct: number | null;
  confidence: "high" | "medium" | "low";
  notes: string;
  // True when this zone's real limit is lot-size-dependent (the RFA/BMO
  // sliding scale) regardless of whether a lot size was supplied — lets the
  // UI tell the user to enter one when it's missing, instead of silently
  // handing back a generic number for a zone where that number is wrong.
  lot_size_dependent: boolean;
}

const SYSTEM_PROMPT = `You are a Los Angeles zoning researcher. Given an LAMC (Los Angeles
Municipal Code) residential zone code and (when provided) a lot size in square feet, find the
maximum buildable amount — expressed as a lot coverage percentage, building footprint as a
percentage of lot area — permitted on that lot.

Your search is restricted to official sources only: LA City Planning (planning.lacity.gov — note
the .gov, not .org, which is not the department's real site), the LAMC text itself
(codelibrary.amlegal.com), and LA Dept. of Building & Safety code guides (ladbs.org). Generic
real-estate or blog summaries are not in scope for this search, on purpose — they're a common
source of stale or oversimplified numbers, which is exactly what you need to avoid here. Read the
actual current ordinance text/table on one of these sites rather than a third-party's paraphrase of
it; if a professional summary PDF from ladbs.org shows worked examples, that's fine to use since
it's an official city source, but don't stop there without confirming against the LAMC/planning.gov
text itself when the two could disagree.

Critical nuance — read carefully: LA's single-family zones (R1 and its variants, RS, RE9-RE40,
RW1, RZ zones) are NOT a flat lot-coverage percentage. They're governed by the Residential Floor
Area (RFA) sliding-scale rules in LAMC 12.21.1-A,10 (the Baseline Mansionization Ordinance for
standard lots) or the Baseline Hillside Ordinance for hillside lots — the maximum buildable floor
area is a formula/table keyed to the lot's square footage (larger lots get a smaller percentage of
their area, not a bigger one), and hillside lots use a different, generally more restrictive
formula than standard lots. Set lot_size_dependent to true for any of these zones.

When lot_size_dependent is true and a lot size in square feet was given in the request:
- Search for the CURRENT sliding-scale table/formula text (not a generic summary) and find the
  specific tier or formula result for that exact lot size.
- Convert the result to an equivalent lot-coverage percentage: (max buildable floor area from the
  formula ÷ given lot size) × 100. This is what buildable_pct should hold — a number computed
  for THIS lot size, not a generic figure for the zone.
- Since you can't know from the address alone whether the parcel is in a Hillside Area overlay,
  default to the standard (non-hillside) formula, but say explicitly in notes that hillside status
  changes the number and should be confirmed on ZIMAS if the parcel might be hillside.
- Use "high" confidence only if you found the actual current sliding-scale table and applied it to
  this lot size. Use "medium" if you had to approximate (e.g., interpolating between tiers, or
  using an older/secondary source for the table).

When lot_size_dependent is true but NO lot size was given in the request: you cannot compute a
correct number — return buildable_pct: null, confidence: "low", and say in notes that this zone's
buildable percentage depends on lot size and to enter the lot size above and look up again.

When lot_size_dependent is false (R2, RD1.5-RD6, R3, R4, RAS3/4, R5, and other zones without an
RFA/BMO overlay): these typically DO have a directly-stated flat lot coverage % independent of lot
size — look that up normally; a clearly-sourced figure can be "high" confidence regardless of
whether a lot size was given.

Return:
- buildable_pct: the lot coverage percentage as a plain number (e.g. 40 for 40%), or null per the
  rule above
- confidence: "high", "medium", or "low" per the rules above
- lot_size_dependent: true/false per the zone, always set regardless of buildable_pct
- notes: 1-2 sentences — what you found, the source, and any caveat (missing lot size, hillside
  uncertainty, etc.)

Be honest — null is fine if nothing credible turns up. Never invent a number, and never apply a
sliding-scale zone's generic/average percentage when a specific lot size was given — compute for
that lot size specifically.

Respond with ONLY a JSON object, no prose, matching this shape exactly:
{ "buildable_pct": number | null, "confidence": "high" | "medium" | "low", "lot_size_dependent": boolean, "notes": string }`;

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limited = await enforceRateLimit(user.id, "lookup-zoning-coverage");
  if (limited) return limited;

  const body = (await req.json()) as { zone?: string; address?: string; city?: string; state?: string; lot_size?: number };
  if (!body.zone || !body.zone.trim()) {
    return NextResponse.json({ error: "No zone provided." }, { status: 400 });
  }

  try {
    const anthropic = getAnthropicClient();
    const query = [
      `Zone: ${body.zone.trim()}`,
      body.lot_size
        ? `Lot size: ${body.lot_size} sqft`
        : "Lot size: not provided — if this zone is lot-size-dependent, say so per your instructions instead of guessing.",
      body.address && `Parcel (for context only, not required to look up individually): ${body.address}, ${body.city ?? ""} ${body.state ?? ""}`,
    ]
      .filter(Boolean)
      .join("\n");

    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1200,
      system: SYSTEM_PROMPT,
      thinking: { type: "adaptive" },
      // Medium, not low — this isn't a plain lookup, it's finding a specific
      // ordinance table/formula and doing the sliding-scale computation for
      // this exact lot size, and "low" effort was prone to shortcutting to a
      // generic/wrong percentage instead of doing that work (the reported
      // bug here).
      output_config: { effort: "medium" },
      // Basic search tool, not the sandboxed 20260209 variant — that one
      // took 60-90s+ in testing, well past a serverless function's timeout.
      // Restricted to official sources only (see SYSTEM_PROMPT) — random
      // real-estate/blog summaries of LA zoning percentages are exactly what
      // was producing wrong numbers. max_uses bumped since a few more
      // searches are needed to land on the right page within this narrower
      // set of domains.
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 5,
          allowed_domains: ["planning.lacity.gov", "codelibrary.amlegal.com", "ladbs.org"],
        },
      ],
      messages: [{ role: "user", content: `Find the max buildable lot coverage % for this LA zone and lot:\n\n${query}` }],
    });

    const text = message.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    if (!text.trim()) throw new Error("No text response from Claude.");

    const result = extractJson<ZoningCoverageResult>(text);
    return NextResponse.json(result);
  } catch (err) {
    console.error("lookup-zoning-coverage failed", err);
    const message = err instanceof Error ? err.message : "Zoning lookup failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
