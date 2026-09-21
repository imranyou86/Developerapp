import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { enforceRateLimit } from "@/lib/rateLimit";
import { getAnthropicClient, CLAUDE_MODEL, extractJson, fetchImageForClaude } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 60;

interface ExtractTradeBidResult {
  trade: string;
  subcontractor_name: string;
  bid_amount: number;
  scope_notes: string;
}

// Same cap as extract-bid — trade bids are usually shorter documents, but a
// generous ceiling costs nothing and avoids truncating a longer one.
const MAX_TEXT_CHARS = 100_000;

const SYSTEM_PROMPT = `You are reading a subcontractor's bid/proposal document for one trade on a
residential construction project (e.g. electrical, plumbing, framing, roofing). Extract:
- The trade this bid covers (a short label, e.g. "Electrical", "Plumbing", "Roofing").
- The subcontractor/company name.
- The total bid amount (as a plain number, no currency symbols).
- A concise scope summary: what the bid says is included (materials vs. labor, permits, demo/haul-away,
  fixture install, testing/inspection, warranty on workmanship — whatever the document actually states).
  Write this as a few sentences or a short bullet-style list of what's covered, in your own words,
  suitable for someone else to judge completeness against. If the document doesn't state something,
  don't invent it.

Respond with ONLY a JSON object matching this shape exactly:
{
  "trade": string,
  "subcontractor_name": string,
  "bid_amount": number,
  "scope_notes": string
}`;

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limited = await enforceRateLimit(user.id, "extract-trade-bid");
  if (limited) return limited;

  const body = (await req.json()) as { text?: string; pageImageUrls?: string[] };

  try {
    const anthropic = getAnthropicClient();
    const content: Array<
      | { type: "text"; text: string }
      | { type: "image"; source: { type: "base64"; media_type: "image/jpeg"; data: string } }
    > = [];

    if (body.text && body.text.trim().length > 200) {
      content.push({ type: "text", text: body.text.slice(0, MAX_TEXT_CHARS) });
    } else if (body.pageImageUrls?.length) {
      for (const url of body.pageImageUrls) {
        try {
          content.push(await fetchImageForClaude(url));
        } catch (err) {
          console.warn(`Skipping trade bid page image ${url}:`, err);
        }
      }
    } else {
      return NextResponse.json({ error: "No bid text or page images provided." }, { status: 400 });
    }

    content.push({ type: "text", text: "Extract the JSON object described in your instructions." });

    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("No text response from Claude.");
    }

    const result = extractJson<ExtractTradeBidResult>(textBlock.text);
    return NextResponse.json(result);
  } catch (err) {
    console.error("extract-trade-bid failed", err);
    const message = err instanceof Error ? err.message : "Trade bid extraction failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
