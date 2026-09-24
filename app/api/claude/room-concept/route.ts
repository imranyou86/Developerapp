import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { enforceRateLimit } from "@/lib/rateLimit";
import { getAnthropicClient, CLAUDE_MODEL, extractJson } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 30;

type ConceptTarget = "gemini" | "midjourney";

interface RoomConceptResult {
  description: string;
  image_prompt?: string;
  midjourney_prompt?: string;
}

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limited = await enforceRateLimit(user.id, "room-concept");
  if (limited) return limited;

  const body = (await req.json()) as {
    roomName?: string;
    roomType?: string;
    style?: string;
    width?: number | null;
    depth?: number | null;
    target?: ConceptTarget;
    // Interior Design's LayoutEditor already knows exactly where every
    // fixture sits (from describeLayout()) — when present, this is real
    // ground truth, not a guess, so the Midjourney instruction below
    // translates it directly instead of inventing a plausible layout.
    layoutDescription?: string;
  };

  if (!body.style || (!body.roomName && !body.roomType)) {
    return NextResponse.json({ error: "style and roomName or roomType are required." }, { status: 400 });
  }

  // Which prompt to write is picked up front (not always both) — asking
  // Claude for the Midjourney prompt's now-fairly-elaborate spatial
  // description costs real output tokens/latency, and most generations
  // only ever use one of the two, so writing the other is wasted work.
  const target: ConceptTarget = body.target === "midjourney" ? "midjourney" : "gemini";

  // A from-scratch image model has no idea what this room actually looks
  // like — the only real signal it can act on is the room's own
  // proportions, so this is computed here (not left for Claude to eyeball
  // from raw numbers) and front-loaded into the image prompt's required
  // shot description. Once a photo of this room exists (uploaded, or from
  // an earlier generation), regenerating switches to an image-edit call
  // that preserves that photo's actual walls/camera framing instead —
  // see handleGenerateImage in rendering-panel.tsx — which is the
  // stronger "follows the real room" path; this only helps the very
  // first, textual generation.
  let shape = "";
  if (body.width && body.depth) {
    const ratio = Math.max(body.width, body.depth) / Math.min(body.width, body.depth);
    const longAxis = body.width >= body.depth ? "width" : "depth";
    if (ratio >= 1.8) shape = `a long, narrow room (elongated along its ${longAxis})`;
    else if (ratio >= 1.3) shape = "a rectangular room";
    else shape = "a roughly square room";
  }
  const dims = body.width && body.depth ? `It is ${shape}, approximately ${body.width}ft x ${body.depth}ft.` : "";

  const geminiInstruction = `2. A concise, ready-to-paste image-generation prompt for a general tool (this app's own
   Gemini-based generator, ChatGPT image generation, etc). Image models follow short, concrete,
   front-loaded prompts far better than long descriptive paragraphs — pack in the specifics, cut
   the flowery language. Keep it to 40-60 words, structured in this order: [shot type${
     shape ? ` chosen to actually show this is ${shape}` : ""
   }] of a [style] [room type]${shape ? `, ${shape}` : ""}, [3-4 concrete materials/finishes],
   [2-3 furniture/fixture pieces], [lighting], [camera/angle], photorealistic, architectural
   photography. ${
     shape
       ? `The room's real shape is ${shape} — the composition and furniture placement must read as
   that shape (e.g. a long narrow room should be framed/furnished to show its length, not
   cropped into a generic square room). `
       : ""
   }No scene-setting prose, no adjectives that don't change what's rendered (skip "beautiful",
   "stunning", "inviting" — every word should be a visual instruction).

Respond with ONLY a JSON object: {"description": string, "image_prompt": string}`;

  const midjourneyInstruction = `2. A prompt in Midjourney's own syntax, for pasting straight into Midjourney (its Discord bot
   or web app — it has no API, so this is never sent anywhere by this app). Midjourney only ever
   sees this text — unlike this app's own built-in generator, it is never shown a floor plan or
   reference photo to check its work against — so this prompt has to spell out the room's real
   layout in words, precisely enough that the result can't come out as a generic boxy room.
   Midjourney prompts are a comma-separated list of short descriptive fragments, not full
   sentences. Include, in this order:
   - a camera/framing fragment chosen specifically to reveal the room's true proportions${
     shape
       ? ` — this room is ${shape}${body.width && body.depth ? `, about ${body.width}ft x ${body.depth}ft` : ""}, so for a long narrow room use a wide-angle shot down its length from one end (never a square-on shot that hides the elongation); for a square room a centered shot that shows all four walls`
       : ""
   }
   - an explicit wall-by-wall layout fragment naming which wall or corner each major piece of
     furniture/fixture sits against (e.g. "sofa against the long back wall, armchair in the near
     left corner, window centered on the right wall, doorway on the left")${
       body.layoutDescription
         ? ` — the room's REAL fixture layout is already known, translate it directly into this
     fragment rather than inventing one: "${body.layoutDescription}"`
         : ` — invent one plausible, internally consistent arrangement for a ${
             body.roomType ?? "room"
           }${shape ? ` of this shape and size` : ""} and keep every other fragment in the prompt consistent with it (don't
     mention a piece of furniture in fragment 3 that contradicts where fragment 2 placed it)`
     }
   - materials, furniture, lighting (same specifics an image-generation prompt would need)
   then end with parameters on their own: "--ar 3:2 --style raw --v 7 --stylize 50" ("--style
   raw" cuts Midjourney's default artistic styling for a more literal, photorealistic result;
   low "--stylize" keeps it following the prompt closely rather than improvising).

Respond with ONLY a JSON object: {"description": string, "midjourney_prompt": string}`;

  const roomLabel = body.roomName ? `"${body.roomName}" (${body.roomType ?? "room"})` : (body.roomType ?? "room");
  const prompt = `Design concept for a ${roomLabel} in a
"${body.style}" interior design style. ${dims}

Write two things:
1. A short (2-3 sentence) design concept description a homeowner would enjoy reading —
   materials, colors, mood, a couple of signature details.
${target === "gemini" ? geminiInstruction : midjourneyInstruction}`;

  try {
    const anthropic = getAnthropicClient();
    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1200,
      messages: [{ role: "user", content: prompt }],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("No text response from Claude.");
    }

    const result = extractJson<RoomConceptResult>(textBlock.text);
    return NextResponse.json({
      description: result.description,
      image_prompt: target === "gemini" ? (result.image_prompt ?? null) : null,
      midjourney_prompt: target === "midjourney" ? (result.midjourney_prompt ?? null) : null,
    });
  } catch (err) {
    console.error("room-concept failed", err);
    const message = err instanceof Error ? err.message : "Concept generation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
