import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient, CLAUDE_MODEL, extractJson } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 30;

interface RoomConceptResult {
  description: string;
  image_prompt: string;
}

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  const dims =
    body.width && body.depth ? `The room is approximately ${body.width}ft x ${body.depth}ft.` : "";

  const prompt = `Design concept for a "${body.roomName}" (${body.roomType ?? "room"}) in a
"${body.style}" interior design style. ${dims}

Write two things:
1. A short (2-3 sentence) design concept description a homeowner would enjoy reading —
   materials, colors, mood, a couple of signature details.
2. A detailed, ready-to-paste photorealistic interior-design image-generation prompt
   (for an external tool like ChatGPT image generation or Midjourney) describing this
   room fully furnished and finished in the "${body.style}" style: camera angle, lighting,
   materials, furniture, fixtures, and color palette. Write it as one dense paragraph,
   the way a professional prompt-engineer would for an interior photography render.

Respond with ONLY a JSON object: {"description": string, "image_prompt": string}`;

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
