import { NextResponse } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient, CLAUDE_MODEL, extractJson, fetchImageForClaude } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 60;

interface PlanPageInput {
  label: string;
  // Publicly-readable Supabase Storage URL for the rendered page image.
  url: string;
}

interface DetectedRoom {
  name: string;
  type: string;
  floor: number;
  width: number | null;
  depth: number | null;
  estimated: boolean;
  source_sheet: string;
}

interface DetectRoomsResult {
  rooms: DetectedRoom[];
  bedroom_count: number;
  bathroom_count: number;
}

const SYSTEM_PROMPT = `You are an expert residential construction estimator reading architectural
floor plans. You will be shown every sheet of a plan set together (a multi-page PDF may
contain separate floors and separate structures such as a main house and an ADU — all
sheets are provided so you can cross-reference them).

Your job:
1. Identify every room/space across ALL sheets, including easily-missed ones: closets,
   hallways, laundry, mechanical rooms, storage, mudrooms, pantries, and covered
   porches/patios.
2. Read width/depth dimensions from labeled callouts on the plan where visible (in feet,
   as decimal numbers, e.g. 10.5). Where a dimension is not clearly labeled, estimate it
   from the drawing scale and set "estimated": true. If you cannot estimate at all, use
   null for width/depth and still set "estimated": true.
3. Assign a floor number to each room based on which sheet it appears on (1 = first
   floor/ground floor, 2 = second floor, etc; use 0 for a basement).
4. Disambiguate repeated room names across separate structures — e.g. if there is a main
   house and a detached ADU and both have a "Bedroom 1", name them distinctly such as
   "Bedroom 1 (Main House)" and "Bedroom 1 (ADU)". Use the "source_sheet" field to record
   which labeled sheet/page each room came from.
5. Count total bedrooms and total bathrooms across the whole plan set (half baths count
   as bathrooms).

Respond with ONLY a JSON object, no prose, matching this shape exactly:
{
  "rooms": [
    {
      "name": string,
      "type": string,          // e.g. "Bedroom", "Bathroom", "Kitchen", "Closet", "Hallway", "Garage", "Mechanical", "Laundry", "Other"
      "floor": number,
      "width": number | null,
      "depth": number | null,
      "estimated": boolean,
      "source_sheet": string   // the sheet label this room was read from
    }
  ],
  "bedroom_count": number,
  "bathroom_count": number
}`;

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as { pages?: PlanPageInput[] };
  const pages = body.pages ?? [];

  if (pages.length === 0) {
    return NextResponse.json({ error: "No plan pages provided." }, { status: 400 });
  }

  try {
    const anthropic = getAnthropicClient();

    // Every stored plan page is sent together in one call so rooms can be
    // cross-referenced across sheets (floors, ADUs, etc). Pages are stored at
    // full resolution for on-screen display, but downscaled here before
    // sending — combined uncompressed, a multi-page plan set can otherwise
    // exceed the Messages API's request-size limit.
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

    const content: Array<
      Anthropic.Messages.TextBlockParam | Anthropic.Messages.ImageBlockParam
    > = [];
    for (const { label, block } of imageBlocks) {
      content.push({ type: "text", text: `Sheet: ${label}` });
      content.push(block);
    }
    content.push({
      type: "text",
      text: "Analyze all sheets above together and return the JSON object described in your instructions.",
    });

    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      // Adaptive thinking at low effort — full-effort reasoning over several plan-sheet images
      // routinely blew past Vercel's 60s function timeout, which surfaced client-side as an
      // endless "Analyzing plan…" spinner rather than a clean error. Do NOT use
      // `thinking: {type: "disabled"}` instead — tested and confirmed to leak reasoning into
      // plain visible text instead of staying in its own thinking block.
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      messages: [{ role: "user", content }],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("No text response from Claude.");
    }

    const result = extractJson<DetectRoomsResult>(textBlock.text);
    return NextResponse.json(result);
  } catch (err) {
    console.error("detect-rooms failed", err);
    const message = err instanceof Error ? err.message : "Room detection failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
