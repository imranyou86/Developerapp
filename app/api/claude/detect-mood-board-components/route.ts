import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { enforceRateLimit } from "@/lib/rateLimit";
import { getAnthropicClient, CLAUDE_MODEL, extractJson, fetchImageForClaude } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 30;

interface DetectComponentsResult {
  items: { label: string }[];
}

// Lists components rather than cropping them out of the photo — bounding-
// box crops from a busy inspiration photo were often ugly or mis-framed,
// and the actual goal is just knowing what's in the shot (a shoppable
// name for each piece), not a picture-of-a-picture. Same shape as
// identify-finishes, scoped wider (furniture too, not just finishes).
const SYSTEM_PROMPT = `You are an experienced interior designer reading a room or inspiration photo to list
its individual design components for a client's mood board.

Identify every distinct, meaningfully separate design element visible in the photo: furniture
pieces (sofa, chair, coffee table, rug, etc.), fixtures (light fixture, faucet, cabinet hardware),
and materials/finishes (flooring, countertop, tile, paint color, wallpaper) — anything a designer
would want as its own labeled line on a mood board's materials list, not the room as a whole.

For each component, give it a short, specific label — specific enough to search for or shop from,
not just "sofa" or "tile": e.g. "Navy linen sofa", "Brass arc floor lamp", "Wide-plank white oak
flooring", "Terracotta subway tile backsplash". Include material, color, and shape/style details
you can actually see.

Only include genuinely distinct, separately-identifiable components — not every visible object
(skip tiny or incidental background items), and not the room's architecture itself (walls,
windows, doors) unless a specific finish on them (like a paint color or wallpaper pattern) is
clearly the point. Aim for 4-10 components for a typical room photo — fewer for a close-up of
just one or two things. If the photo doesn't show any identifiable design components, return an
empty items array.

Respond with ONLY a JSON object matching this shape exactly: { "items": [ { "label": string } ] }`;

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limited = await enforceRateLimit(user.id, "detect-mood-board-components");
  if (limited) return limited;

  const body = (await req.json()) as { imageUrl?: string };
  if (!body.imageUrl) {
    return NextResponse.json({ error: "No image provided." }, { status: 400 });
  }

  try {
    const anthropic = getAnthropicClient();
    const imageBlock = await fetchImageForClaude(body.imageUrl);

    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            imageBlock,
            { type: "text", text: "List the design components shown and return the JSON object described in your instructions." },
          ],
        },
      ],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("No text response from Claude.");
    }

    const result = extractJson<DetectComponentsResult>(textBlock.text);
    return NextResponse.json(result);
  } catch (err) {
    console.error("detect-mood-board-components failed", err);
    const message = err instanceof Error ? err.message : "Could not find components in this photo.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
