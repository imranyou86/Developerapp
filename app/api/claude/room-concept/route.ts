import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { enforceRateLimit } from "@/lib/rateLimit";
import { getAnthropicClient, CLAUDE_MODEL, extractJson } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 30;

interface RoomConceptResult {
  description: string;
  image_prompt: string;
  midjourney_prompt: string;
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
  };

  if (!body.roomName || !body.style) {
    return NextResponse.json({ error: "roomName and style are required." }, { status: 400 });
  }

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

  const prompt = `Design concept for a "${body.roomName}" (${body.roomType ?? "room"}) in a
"${body.style}" interior design style. ${dims}

Write three things:
1. A short (2-3 sentence) design concept description a homeowner would enjoy reading —
   materials, colors, mood, a couple of signature details.
2. A concise, ready-to-paste image-generation prompt for a general tool (this app's own
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
3. A separate prompt in Midjourney's own syntax, for pasting straight into Midjourney (its
   Discord bot or web app — it has no API, so this is never sent anywhere by this app). Midjourney
   prompts are a comma-separated list of short descriptive fragments, not full sentences — cover
   the same specifics as the image prompt above (materials, furniture, lighting, camera angle)${
     shape ? `, and work in that it's ${shape}` : ""
   } — then end with parameters on their own: "--ar 3:2 --style raw --v 7 --stylize 50" ("--style
   raw" cuts Midjourney's default artistic styling for a more literal, photorealistic result;
   low "--stylize" keeps it following the prompt closely rather than improvising).

Respond with ONLY a JSON object: {"description": string, "image_prompt": string, "midjourney_prompt": string}`;

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
    return NextResponse.json(result);
  } catch (err) {
    console.error("room-concept failed", err);
    const message = err instanceof Error ? err.message : "Concept generation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
