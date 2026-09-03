import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient, CLAUDE_MODEL, extractJson } from "@/lib/anthropic";
import { FINISH_CATEGORIES } from "@/lib/finishes-db";

export const runtime = "nodejs";
export const maxDuration = 30;

interface IdentifyFinishesResult {
  items: {
    name: string;
    category: string;
    description: string;
    color: string | null;
    confidence: "high" | "medium" | "low";
  }[];
}

const SYSTEM_PROMPT = `You are an experienced residential interior finishes and materials expert.
You will be shown one photo or screenshot — it could be a professional listing photo, a phone
snapshot of a real room, a screenshot from a design/inspiration site, or a rendering. It may show
one room or just a close-up of a single surface or fixture.

Identify every distinct finish, material, or fixture visibly used in the image: things like
stone or tile type, countertop material, flooring, cabinetry style/finish, paint color/sheen,
faucets and other plumbing fixtures, lighting fixtures, hardware, and appliances.

For each item you identify:
- Give it a short descriptive name (e.g. "Honed Carrara marble countertop", "Matte black
  gooseneck kitchen faucet", "Wide-plank white oak flooring").
- Classify it into exactly one of these categories: ${FINISH_CATEGORIES.join(", ")}.
- Write a one-sentence description covering material, color/finish, and any notable detail.
- Give your best guess at the dominant color as a short phrase, or null if not applicable.
- Rate your confidence as "high", "medium", or "low" — be honest; a low-resolution or partially
  obscured item should be "low", not guessed at with false confidence.

Only include items you can actually see — do not invent finishes that aren't visible. If the
image doesn't show any identifiable finishes (e.g. it's unrelated to construction/interiors),
return an empty items array.

Respond with ONLY a JSON object matching this shape exactly:
{
  "items": [
    {
      "name": string,
      "category": string,
      "description": string,
      "color": string | null,
      "confidence": "high" | "medium" | "low"
    }
  ]
}`;

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as { imageUrl?: string };
  if (!body.imageUrl) {
    return NextResponse.json({ error: "No image provided." }, { status: 400 });
  }

  try {
    const anthropic = getAnthropicClient();

    const imgRes = await fetch(body.imageUrl);
    if (!imgRes.ok) throw new Error(`Could not fetch the uploaded image: ${imgRes.status}`);
    const contentType = imgRes.headers.get("content-type") ?? "image/png";
    const buffer = Buffer.from(await imgRes.arrayBuffer());

    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: contentType.includes("jpeg") ? "image/jpeg" : contentType.includes("webp") ? "image/webp" : "image/png",
                data: buffer.toString("base64"),
              },
            },
            { type: "text", text: "Identify the finishes shown and return the JSON object described in your instructions." },
          ],
        },
      ],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("No text response from Claude.");
    }

    const result = extractJson<IdentifyFinishesResult>(textBlock.text);
    return NextResponse.json(result);
  } catch (err) {
    console.error("identify-finishes failed", err);
    const message = err instanceof Error ? err.message : "Finish identification failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
