import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { enforceRateLimit } from "@/lib/rateLimit";
import { getAnthropicClient, CLAUDE_MODEL, extractJson, fetchImageForClaude } from "@/lib/anthropic";
import { WARRANTY_REQUEST_CATEGORIES } from "@/lib/warrantyRequestCategories";

export const runtime = "nodejs";
export const maxDuration = 60;

interface ExtractedFinding {
  title: string;
  detail: string | null;
  category: string | null;
}

interface ExtractInspectionReportResult {
  items: ExtractedFinding[];
}

// Generous cap, same reasoning as extract-bid — a long inspection report
// genuinely needs this much room, and findings can appear on any page.
const MAX_TEXT_CHARS = 100_000;

const SYSTEM_PROMPT = `You are reading a home inspection report for a residential property under
warranty. Extract every distinct issue, defect, or deficiency the inspector noted —
anything that would need to be fixed — as a separate item.

For each item:
- "title": a short, specific description of the issue, written the way a homeowner would
  file a warranty request (e.g. "Leaky faucet in kitchen", "Cracked tile in primary bathroom
  shower", "GFCI outlet not resetting in garage"). Include the room/location when the
  report states one.
- "detail": any extra context worth keeping as a note — severity, the inspector's
  recommendation, a code reference, measurements. Use null if there's nothing beyond the
  title worth keeping.
- "category": which trade would fix this — exactly one of: ${WARRANTY_REQUEST_CATEGORIES.join(", ")}.
  Pick the closest match (e.g. a cracked tile is "Flooring", a GFCI outlet is "Electrical", a
  water heater is "Plumbing"). Use "Other" only when nothing else reasonably fits.

Do not include passed/satisfactory items, general observations with no action needed, or
boilerplate report text (cover pages, inspector credentials, disclaimers). If the same
issue is mentioned in a summary AND in a detail section, list it once.

Respond with ONLY a JSON object matching this shape exactly:
{ "items": [{ "title": string, "detail": string | null, "category": string }] }
If no actionable issues are found, respond with { "items": [] }.`;

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limited = await enforceRateLimit(user.id, "extract-inspection-report");
  if (limited) return limited;

  const body = (await req.json()) as { text?: string; pageImageUrls?: string[] };

  try {
    const anthropic = getAnthropicClient();
    const content: Array<
      | { type: "text"; text: string }
      | { type: "image"; source: { type: "base64"; media_type: "image/jpeg"; data: string } }
    > = [];

    if (body.text && body.text.trim().length > 50) {
      content.push({ type: "text", text: body.text.slice(0, MAX_TEXT_CHARS) });
    } else if (body.pageImageUrls?.length) {
      for (const url of body.pageImageUrls) {
        try {
          content.push(await fetchImageForClaude(url));
        } catch (err) {
          console.warn(`Skipping inspection report page image ${url}:`, err);
        }
      }
    } else {
      return NextResponse.json({ error: "No report text or page images provided." }, { status: 400 });
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

    const result = extractJson<ExtractInspectionReportResult>(textBlock.text);
    return NextResponse.json(result);
  } catch (err) {
    console.error("extract-inspection-report failed", err);
    const message = err instanceof Error ? err.message : "Inspection report extraction failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
