import { NextResponse } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { createClient } from "@/lib/supabase/server";
import { enforceRateLimit } from "@/lib/rateLimit";
import {
  getAnthropicClient,
  CLAUDE_MODEL,
  extractJson,
  fetchImageBufferForClaude,
  bufferToClaudeImageBlock,
} from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 90;

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

interface LocateResult {
  found: boolean;
  sheetIndex?: number;
  x0?: number;
  y0?: number;
  x1?: number;
  y1?: number;
}

interface ManualCropInput {
  url: string;
  label: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// Pass 1: just find where the room sits on the sheet set. A whole floor plan
// sheet downscaled to Claude's ~1568px ceiling leaves any single room as only
// a small fraction of that image — a fridge or toilet symbol at that scale
// can be just a handful of pixels, effectively unreadable. Locating the
// room first (cheap: only needs to read a room label, not fine fixture
// symbols) lets pass 2 crop that region out of the ORIGINAL full-resolution
// sheet and re-encode just that crop at the same 1568px ceiling — the room
// now fills the frame instead of a corner of it.
const LOCATE_SYSTEM_PROMPT = `You are looking at architectural floor plan sheet(s) for a home. Your only
job right now is to find ONE specific room on these sheets and report where it sits on its
sheet, so a zoomed-in crop of just that room can be made for closer inspection.

Look for the room's label/name printed on the plan (e.g. "KITCHEN", "POWDER ROOM"), or a
room of the matching type and roughly matching size if it isn't explicitly labeled. Respond
with ONLY a JSON object, no prose:
{ "found": boolean, "sheetIndex": number, "x0": number, "y0": number, "x1": number, "y1": number }

sheetIndex is the 0-based index into the sheet list you were given, in the order shown.
x0, y0, x1, y1 are the room's bounding box as FRACTIONS (0 to 1) of that sheet image's full
width/height, with x0 < x1 and y0 < y1 — include a generous margin around the room's outer
walls (at least 10% of the room's own size on each side) so nothing near the edges gets cut
off. If you can't confidently find this room on any sheet, set "found" to false and omit the
other fields.`;

const SYSTEM_PROMPT = `You are a residential interior designer laying out fixtures/furniture for one
room, using a zoomed-in crop of the architectural plan sheet centered on this exact room.

You'll be given: the room's name/type, its width and depth in feet, and a fixed catalog of
fixture/furniture types with their own default footprint sizes (width x depth, in feet) — you
can ONLY place items whose "typeId" is in that catalog, using their given width/depth exactly
(do not invent new types or resize them).

Your job:
1. This crop was already located as showing this specific room, so look closely at what's
   actually drawn inside it. Real plans usually show fixture footprints sketched in (counters,
   islands, cooktops, refrigerators, toilets, showers/tubs, vanities) — read their real
   positions: which wall the cabinet run is on, where the island/table sits, which corner the
   toilet/shower is in, etc. Small printed labels near a fixture (e.g. "REF.", "RH" on a
   cooktop) confirm what a symbol is — use them.
2. Only if the crop genuinely doesn't show this room clearly enough to read (wrong crop, plan
   too faint/small, no fixtures actually drawn), fall back to a sensible standard arrangement
   for a room of this type and size (e.g. a kitchen: cabinets along the longer wall, island
   centered if there's enough clearance; a bathroom: toilet and shower/tub on opposite walls,
   vanity along a third). Set "found_on_plan" to false in this case, true if you actually used
   what's drawn in the crop.
3. Only place fixtures that reasonably fit — don't overcrowd a small room. 3-7 items is
   typical. Leave clear walking space; don't overlap fixtures.
4. Position (x, y) is the fixture's top-left corner in feet, measured from the room's own
   top-left corner (x=0..roomWidth, y=0..roomDepth) — NOT the crop's pixel coordinates. The
   crop includes some margin outside the room's walls, so map what you see back onto the
   room's actual footprint rather than the crop's edges. x + the catalog width must stay
   <= roomWidth (or <= roomDepth if rotated), same for y/depth.
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

  const limited = await enforceRateLimit(user.id, "suggest-room-layout");
  if (limited) return limited;

  const body = (await req.json()) as {
    pages?: PlanPageInput[];
    roomName?: string;
    roomType?: string;
    roomWidth?: number;
    roomDepth?: number;
    fixtures?: FixtureOption[];
    manualCrop?: ManualCropInput;
  };
  const pages = body.pages ?? [];
  const fixtures = body.fixtures ?? [];
  const manualCrop = body.manualCrop;

  if (pages.length === 0 && !manualCrop) {
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

    let crop: { block: Anthropic.Messages.ImageBlockParam; label: string; dataUrl: string } | null = null;
    // Only populated on the auto-locate path — referenced by the full-sheet
    // fallback below, which is never reached when manualCrop is set (that
    // path always produces a crop or returns early).
    let sheets: { label: string; buffer: Buffer; width: number; height: number }[] = [];

    if (manualCrop) {
      // The person drew the crop box themselves on the Plan tab preview —
      // skip the auto-locate pass entirely (it's the thing being worked
      // around) and just crop exactly what they selected out of that one
      // page's full-resolution image.
      const { buffer, width: pageWidth, height: pageHeight } = await fetchImageBufferForClaude(manualCrop.url);
      const x0 = Math.max(0, Math.min(manualCrop.x0, manualCrop.x1));
      const x1 = Math.min(1, Math.max(manualCrop.x0, manualCrop.x1));
      const y0 = Math.max(0, Math.min(manualCrop.y0, manualCrop.y1));
      const y1 = Math.min(1, Math.max(manualCrop.y0, manualCrop.y1));
      const left = Math.round(x0 * pageWidth);
      const top = Math.round(y0 * pageHeight);
      const width = Math.max(1, Math.round((x1 - x0) * pageWidth));
      const height = Math.max(1, Math.round((y1 - y0) * pageHeight));
      if (width < 20 || height < 20) {
        return NextResponse.json({ error: "Selected area is too small — draw a larger box around the room." }, { status: 400 });
      }
      const croppedBuffer = await sharp(buffer)
        .extract({ left, top, width, height })
        .toBuffer();
      const croppedBlock = await bufferToClaudeImageBlock(croppedBuffer);
      crop = {
        block: croppedBlock,
        label: manualCrop.label,
        dataUrl: `data:${croppedBlock.source.media_type};base64,${croppedBlock.source.data}`,
      };
    } else {
      if (pages.length === 0) {
        return NextResponse.json(
          { error: "No plan pages to reference — upload plan pages on the Plan tab first." },
          { status: 400 }
        );
      }

      // Fetch every sheet once, at full resolution — reused both for the
      // locate pass (downscaled) and, if a room is found, for the crop.
      sheets = await Promise.all(
        pages.map(async (page) => {
          try {
            return { label: page.label, ...(await fetchImageBufferForClaude(page.url)) };
          } catch (err) {
            throw new Error(`Failed to prepare plan page "${page.label}": ${err instanceof Error ? err.message : String(err)}`);
          }
        })
      );

      const roomDescription = `Room to find: ${body.roomName ? `"${body.roomName}" — ` : ""}${body.roomType}, approx ${body.roomWidth}ft x ${body.roomDepth}ft.`;

      // Pass 1: locate the room on the sheet set.
      const locateBlocks = await Promise.all(sheets.map((s) => bufferToClaudeImageBlock(s.buffer)));
      const locateContent: Array<Anthropic.Messages.TextBlockParam | Anthropic.Messages.ImageBlockParam> = [];
      sheets.forEach((s, i) => {
        locateContent.push({ type: "text", text: `Sheet ${i}: ${s.label}` });
        locateContent.push(locateBlocks[i]);
      });
      locateContent.push({ type: "text", text: `${roomDescription}\nReturn the JSON object described in your instructions.` });

      try {
        const locateMessage = await anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 1000,
          system: LOCATE_SYSTEM_PROMPT,
          thinking: { type: "adaptive" },
          output_config: { effort: "low" },
          messages: [{ role: "user", content: locateContent }],
        });
        const locateText = locateMessage.content.find((b) => b.type === "text");
        if (locateText && locateText.type === "text") {
          const located = extractJson<LocateResult>(locateText.text);
          if (
            located.found &&
            located.sheetIndex != null &&
            sheets[located.sheetIndex] &&
            located.x0 != null &&
            located.y0 != null &&
            located.x1 != null &&
            located.y1 != null &&
            located.x1 > located.x0 &&
            located.y1 > located.y0
          ) {
            const sheet = sheets[located.sheetIndex];
            const boxW = (located.x1 - located.x0) * sheet.width;
            const boxH = (located.y1 - located.y0) * sheet.height;
            // Pad another 15% of the box's own size on each side so fixtures
            // right against a wall (the usual case) aren't clipped by a tight
            // or slightly-off bounding box.
            const padX = boxW * 0.15;
            const padY = boxH * 0.15;
            const left = Math.max(0, Math.round(located.x0 * sheet.width - padX));
            const top = Math.max(0, Math.round(located.y0 * sheet.height - padY));
            const right = Math.min(sheet.width, Math.round(located.x1 * sheet.width + padX));
            const bottom = Math.min(sheet.height, Math.round(located.y1 * sheet.height + padY));
            const width = right - left;
            const height = bottom - top;
            if (width > 20 && height > 20) {
              const croppedBuffer = await sharp(sheet.buffer).extract({ left, top, width, height }).toBuffer();
              // Re-encode the crop at the same resolution ceiling used
              // elsewhere — but now that ceiling covers just this room
              // instead of the whole sheet, so fixture symbols land at
              // several times the effective resolution they had before.
              const croppedBlock = await bufferToClaudeImageBlock(croppedBuffer);
              // Same crop, sent back to the client too — so the person asking
              // for a suggested layout can actually see what region of the
              // plan it was read from and judge for themselves whether it's
              // the right room and whether the result matches it, rather than
              // trusting the placement blind.
              crop = {
                block: croppedBlock,
                label: sheet.label,
                dataUrl: `data:${croppedBlock.source.media_type};base64,${croppedBlock.source.data}`,
              };
            }
          }
        }
      } catch (err) {
        // Locate pass failing (bad JSON, transient error) shouldn't sink the
        // whole request — fall through to the full-sheet pass below.
        console.error("suggest-room-layout locate pass failed", err);
      }
    }

    const content: Array<Anthropic.Messages.TextBlockParam | Anthropic.Messages.ImageBlockParam> = [];
    if (crop) {
      content.push({ type: "text", text: `Zoomed-in crop of this room from sheet: ${crop.label}` });
      content.push(crop.block);
    } else {
      // Couldn't locate the room — fall back to sending every full sheet,
      // same as before, and let Claude's own found_on_plan: false path
      // produce a standard layout instead.
      const fullBlocks = await Promise.all(sheets.map((s) => bufferToClaudeImageBlock(s.buffer)));
      sheets.forEach((s, i) => {
        content.push({ type: "text", text: `Sheet: ${s.label}` });
        content.push(fullBlocks[i]);
      });
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
      // Effort bumped from "low" to "medium" for this pass specifically —
      // reading exact fixture positions off a plan is the part that most
      // needed the accuracy, and it's now working off a much smaller,
      // zoomed crop rather than a whole multi-room sheet, so the extra
      // reasoning budget costs less latency than it would have before.
      thinking: { type: "adaptive" },
      output_config: { effort: crop ? "medium" : "low" },
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

    return NextResponse.json({
      items: validated,
      found_on_plan: result.found_on_plan,
      notes: result.notes,
      located_crop: crop ? { dataUrl: crop.dataUrl, label: crop.label } : null,
    });
  } catch (err) {
    console.error("suggest-room-layout failed", err);
    const message = err instanceof Error ? err.message : "Layout suggestion failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
