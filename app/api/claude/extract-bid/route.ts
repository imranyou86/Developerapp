import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient, CLAUDE_MODEL, extractJson } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 60;

interface ExtractedPaymentLine {
  label: string;
  amount: number;
}

interface ExtractBidResult {
  contractor: string;
  total_amount: number;
  payment_schedule: ExtractedPaymentLine[];
}

// Generous cap — long bid documents genuinely need this much room; payment
// schedules often sit on later pages and must not get truncated away.
const MAX_TEXT_CHARS = 100_000;

const SYSTEM_PROMPT = `You are reading a contractor bid/proposal document for a residential
construction project. Extract:
- The contractor/company name.
- The total contract amount (as a plain number, no currency symbols).
- The full payment/draw schedule: every line item with its label (e.g. "Deposit",
  "Foundation complete", "Rough-in complete", "Final payment") and its dollar amount.

Payment schedules are often located well into the document (not on page 1) — read the
entire document provided, and if you see a heading like "Payment Schedule", "Draw
Schedule", or "Schedule of Values", prioritize accuracy in that section. If dollar
amounts are listed as percentages of the total, convert them to dollar amounts using the
total contract amount.

Respond with ONLY a JSON object matching this shape exactly:
{
  "contractor": string,
  "total_amount": number,
  "payment_schedule": [{ "label": string, "amount": number }]
}`;

function truncatePrioritizingScheduleSection(text: string): string {
  if (text.length <= MAX_TEXT_CHARS) return text;

  const headingMatch = text.match(/(payment\s+schedule|draw\s+schedule|schedule\s+of\s+values)/i);
  if (!headingMatch || headingMatch.index === undefined) {
    return text.slice(0, MAX_TEXT_CHARS);
  }

  // Keep a good chunk of the document lead-in (contractor name, contract total,
  // scope) plus everything from the schedule heading onward, up to the cap.
  const leadIn = text.slice(0, 8_000);
  const remaining = MAX_TEXT_CHARS - leadIn.length;
  const scheduleSection = text.slice(headingMatch.index, headingMatch.index + remaining);
  return `${leadIn}\n...\n${scheduleSection}`;
}

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as { text?: string; pageImageUrls?: string[] };

  try {
    const anthropic = getAnthropicClient();
    const content: Array<
      | { type: "text"; text: string }
      | {
          type: "image";
          source: { type: "base64"; media_type: "image/png" | "image/jpeg"; data: string };
        }
    > = [];

    if (body.text && body.text.trim().length > 200) {
      // Normal path: text was extracted from the PDF client-side.
      content.push({ type: "text", text: truncatePrioritizingScheduleSection(body.text) });
    } else if (body.pageImageUrls?.length) {
      // Fallback for scanned/image-only bids: send rendered page images instead.
      for (const url of body.pageImageUrls) {
        const res = await fetch(url);
        if (!res.ok) continue;
        const contentType = res.headers.get("content-type") ?? "image/png";
        const buffer = Buffer.from(await res.arrayBuffer());
        content.push({
          type: "image",
          source: {
            type: "base64",
            media_type: contentType.includes("jpeg") ? "image/jpeg" : "image/png",
            data: buffer.toString("base64"),
          },
        });
      }
    } else {
      return NextResponse.json({ error: "No bid text or page images provided." }, { status: 400 });
    }

    content.push({ type: "text", text: "Extract the JSON object described in your instructions." });

    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("No text response from Claude.");
    }

    const result = extractJson<ExtractBidResult>(textBlock.text);
    return NextResponse.json(result);
  } catch (err) {
    console.error("extract-bid failed", err);
    const message = err instanceof Error ? err.message : "Bid extraction failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
