import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient, CLAUDE_MODEL, extractJson } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 30;

interface ZoningCoverageResult {
  buildable_pct: number | null;
  confidence: "high" | "medium" | "low";
  notes: string;
}

const SYSTEM_PROMPT = `You are a Los Angeles zoning researcher. Given an LAMC (Los Angeles
Municipal Code) residential zone code, search the web to find the maximum lot coverage
percentage — building footprint as a percentage of lot area — generally permitted in that zone.
Prefer official sources: LA City Planning (planning.lacity.org), the LAMC itself, or well-sourced
professional summaries (architects/zoning consultants) over generic articles.

Important nuance: LA's single-family zones (R1 and its variants, RS, RE9-RE40, RW1, RZ zones)
are governed by the Baseline Hillside Ordinance / Residential Floor Area (RFA) District rules for
many parcels — total buildable floor area is set by a sliding scale based on lot size (and by
hillside/non-hillside status), NOT a flat lot-coverage percentage. For those zones, give your best
general lot-coverage percentage anyway (useful as a rough starting-point estimate) but set
confidence no higher than "medium" and say so explicitly in notes. Zones without an RFA overlay
(R2, RD1.5-RD6, R3, R4, RAS3/4, R5) more commonly do have a directly-stated lot coverage % — for
those, a clearly-sourced figure can be "high" confidence.

Return:
- buildable_pct: the lot coverage percentage as a plain number (e.g. 40 for 40%), or null if you
  can't find a credible figure
- confidence: "high", "medium", or "low" per the rule above
- notes: 1-2 sentences — what you found, the source, and the RFA/sliding-scale caveat when it
  applies to this zone

Be honest — null is fine if nothing credible turns up. Never invent a number.

Respond with ONLY a JSON object, no prose, matching this shape exactly:
{ "buildable_pct": number | null, "confidence": "high" | "medium" | "low", "notes": string }`;

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as { zone?: string; address?: string; city?: string; state?: string };
  if (!body.zone || !body.zone.trim()) {
    return NextResponse.json({ error: "No zone provided." }, { status: 400 });
  }

  try {
    const anthropic = getAnthropicClient();
    const query = [
      `Zone: ${body.zone.trim()}`,
      body.address && `Parcel (for context only, not required to look up individually): ${body.address}, ${body.city ?? ""} ${body.state ?? ""}`,
    ]
      .filter(Boolean)
      .join("\n");

    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1200,
      system: SYSTEM_PROMPT,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      // Basic search tool, not the sandboxed 20260209 variant — that one
      // took 60-90s+ in testing, well past a serverless function's timeout.
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
      messages: [{ role: "user", content: `Find the max lot coverage % for this LA zone:\n\n${query}` }],
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
