import { NextResponse } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient, CLAUDE_MODEL, extractJson, fetchImageForClaude } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 60;

interface PlanPageInput {
  label: string;
  url: string;
}

interface FixtureOption {
  id: string;
  label: string;
  width: number;
  depth: number;
}

interface SuggestedItem {
  typeId: string;
  x: number;
  y: number;
  rotated: boolean;
}

interface SuggestLayoutResult {
  items: SuggestedItem[];
  found_on_plan: boolean;
  notes: string | null;
}

const SYSTEM_PROMPT = `You are a residential interior designer laying out fixtures/furniture for one
room, using the architectural plan sheets you're shown as reference.

You'll be given: the room's name/type, its width and depth in feet, and a fixed catalog of
fixture/furniture types with their own default footprint sizes (width x depth, in feet) — you
can ONLY place items whose "typeId" is in that catalog, using their given width/depth exactly
(do not invent new types or resize them).

Your job:
1. Try to find this specific room on the plan sheets (match by name/label and approximate
   size). Real plans often show fixture footprints already sketched in (counters, islands,
   fixtures, plumbing) — if you can see them, base your placement on what's actually drawn:
   which wall the cabinet run is on, where the island/table sits, which corner the
   toilet/shower is in, etc.
2. If you can't confidently locate this room on the plan (wrong sheet set, room not labeled,
   plan too unclear), don't guess wildly — instead lay out a sensible, standard arrangement
   for a room of this type and size (e.g. a kitchen: cabinets along the longer wall, island
   centered if there's enough clearance; a bathroom: toilet and shower/tub on opposite walls,
   vanity along a third). Set "found_on_plan" to false in this case, true if you actually used
   the plan.
3. Only place fixtures that reasonably fit — don't overcrowd a small room. 3-7 items is
   typical. Leave clear walking space; don't overlap fixtures.
4. Position (x, y) is the fixture's top-left corner in feet, measured from the room's own
   top-left corner (x=0..roomWidth, y=0..roomDepth) — NOT the plan sheet's coordinates. x + the
   catalog width must stay <= roomWidth (or <= roomDepth if rotated), same for y/depth.
5. Set "rotated": true when the fixture makes more sense placed sideways (its catalog
   width/depth swapped) for this spot — e.g. a cabinet run along a side wall instead of the
   back wall.

Respond with ONLY a JSON object, no prose, matching this shape exactly:
{ "items": [ { "typeId": string, "x": number, "y": number, "rotated": boolean } ], "found_on_plan": boolean, "notes": string | null }`;

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
    roomName?: string;
    roomType?: string;
    roomWidth?: number;
    roomDepth?: number;
    fixtures?: FixtureOption[];
  };
  const pages = body.pages ?? [];
  const fixtures = body.fixtures ?? [];

  if (pages.length === 0) {
    return NextResponse.json({ error: "No plan pages to reference — upload plan pages on the Plan tab first." }, { status: 400 });
  }
  if (!body.roomType || !body.roomWidth || !body.roomDepth) {
    return NextResponse.json({ error: "Missing room type or dimensions." }, { status: 400 });
  }
  if (fixtures.length === 0) {
    return NextResponse.json({ error: "No fixture catalog provided." }, { status: 400 });
  }

  try {
    const anthropic = getAnthropicClient();

    const imageBlocks = await Promise.all(
      pages.map(async (page) => {
        try {
          return { label: page.label, block: await fetchImageForClaude(page.url) };
        } catch (err) {
          throw new Error(`Failed to prepare plan page "${page.label}": ${err instanceof Error ? err.message : String(err)}`);
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
      text: `Room: ${body.roomName ? `"${body.roomName}" — ` : ""}${body.roomType}, ${body.roomWidth}ft x ${body.roomDepth}ft.
Fixture catalog (typeId, label, width x depth in feet): ${JSON.stringify(fixtures)}
Return the JSON object described in your instructions.`,
    });

    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      // Same latency lesson as detect-rooms — full-effort reasoning over
      // several plan-sheet images routinely exceeds a serverless function's
      // timeout budget.
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      messages: [{ role: "user", content }],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("No text response from Claude.");
    }

    const result = extractJson<SuggestLayoutResult>(textBlock.text);

    // Never trust placements verbatim — clamp/validate against the actual
    // catalog and room bounds server-side rather than assuming Claude's
    // arithmetic is exact.
    const catalogById = new Map(fixtures.map((f) => [f.id, f]));
    const validated = result.items.filter((it) => {
      const f = catalogById.get(it.typeId);
      if (!f) return false;
      const w = it.rotated ? f.depth : f.width;
      const d = it.rotated ? f.width : f.depth;
      return w <= body.roomWidth! + 0.01 && d <= body.roomDepth! + 0.01;
    });

    return NextResponse.json({ items: validated, found_on_plan: result.found_on_plan, notes: result.notes });
  } catch (err) {
    console.error("suggest-room-layout failed", err);
    const message = err instanceof Error ? err.message : "Layout suggestion failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
