import { NextResponse } from "next/server";
import sharp from "sharp";
import { createClient } from "@/lib/supabase/server";
import { enforceRateLimit } from "@/lib/rateLimit";
import { getAnthropicClient, CLAUDE_MODEL, extractJson, fetchImageBufferForClaude, bufferToClaudeImageBlock } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 45;

interface DetectedComponent {
  label: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface DetectComponentsResult {
  items: DetectedComponent[];
}

const SYSTEM_PROMPT = `You are an experienced interior designer reading a room or inspiration photo to break
it down into its individual design components for a client's mood board.

Identify every distinct, meaningfully separate design element visible in the photo: furniture
pieces (sofa, chair, coffee table, rug, etc.), fixtures (light fixture, faucet, cabinet hardware),
and materials/finishes (flooring, countertop, tile, paint color, wallpaper) — anything a designer
would want as its own labeled swatch or reference on a mood board, not the room as a whole.

For each component:
- Give it a short, specific label (e.g. "Navy linen sofa", "Brass arc floor lamp", "Wide-plank
  white oak flooring", "Terracotta subway tile backsplash") — specific enough to search for or
  shop from, not just "sofa" or "tile".
- Give a bounding box as FRACTIONS (0 to 1) of the image's width/height: x0, y0 (top-left corner)
  and x1, y1 (bottom-right corner), with x0 < x1 and y0 < y1 — tight enough to isolate just that
  component without cutting it off.

Only include genuinely distinct, separately-identifiable components — not every visible object
(skip tiny or incidental background items), and not the room's architecture itself (walls,
windows, doors) unless a specific finish on them (like a paint color or wallpaper pattern) is
clearly the point. Aim for 4-10 components for a typical room photo — fewer for a close-up of
just one or two things. If the photo doesn't show any identifiable design components, return an
empty items array.

Respond with ONLY a JSON object matching this shape exactly:
{ "items": [ { "label": string, "x0": number, "y0": number, "x1": number, "y1": number } ] }`;

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

    // Fetched once at full resolution — reused both for the vision call
    // (downscaled) and for cropping each found component out afterward, so
    // the crops come from the original photo rather than a copy already
    // shrunk to Claude's ~1568px ceiling.
    const { buffer, width: imgWidth, height: imgHeight } = await fetchImageBufferForClaude(body.imageUrl);
    const imageBlock = await bufferToClaudeImageBlock(buffer);

    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            imageBlock,
            { type: "text", text: "Identify the design components shown and return the JSON object described in your instructions." },
          ],
        },
      ],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("No text response from Claude.");
    }

    const result = extractJson<DetectComponentsResult>(textBlock.text);

    const crops = await Promise.all(
      result.items
        .filter((it) => it.x1 > it.x0 && it.y1 > it.y0)
        .map(async (it) => {
          const boxW = (it.x1 - it.x0) * imgWidth;
          const boxH = (it.y1 - it.y0) * imgHeight;
          // Small padding so a tightly-drawn box doesn't shave off the
          // component's own edge.
          const padX = boxW * 0.06;
          const padY = boxH * 0.06;
          const left = Math.max(0, Math.round(it.x0 * imgWidth - padX));
          const top = Math.max(0, Math.round(it.y0 * imgHeight - padY));
          const right = Math.min(imgWidth, Math.round(it.x1 * imgWidth + padX));
          const bottom = Math.min(imgHeight, Math.round(it.y1 * imgHeight + padY));
          const width = right - left;
          const height = bottom - top;
          if (width < 20 || height < 20) return null;

          const jpeg = await sharp(buffer).extract({ left, top, width, height }).jpeg({ quality: 88 }).toBuffer();
          return { label: it.label, dataUrl: `data:image/jpeg;base64,${jpeg.toString("base64")}` };
        })
    );

    return NextResponse.json({ items: crops.filter((c): c is { label: string; dataUrl: string } => c !== null) });
  } catch (err) {
    console.error("detect-mood-board-components failed", err);
    const message = err instanceof Error ? err.message : "Could not find components in this photo.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
