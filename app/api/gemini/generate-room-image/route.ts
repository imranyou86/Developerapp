import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { enforceRateLimit } from "@/lib/rateLimit";
import { generateRoomImage, generateRoomImageFromPlan } from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 90;

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limited = await enforceRateLimit(user.id, "generate-room-image");
  if (limited) return limited;

  const body = (await req.json()) as {
    prompt?: string;
    planImageUrls?: string[];
    roomName?: string;
    floor?: number | null;
  };
  if (!body.prompt || !body.prompt.trim()) {
    return NextResponse.json({ error: "Missing image prompt." }, { status: 400 });
  }

  try {
    // Grounds the render in the construction's own floor plan sheet(s)
    // when they're available — the only real layout signal there is
    // before any actual photo of this room exists. See
    // generateRoomImageFromPlan's own comment for why.
    const image =
      body.planImageUrls?.length && body.roomName
        ? await generateRoomImageFromPlan(body.planImageUrls, body.roomName, body.floor ?? null, body.prompt)
        : await generateRoomImage(body.prompt);
    return NextResponse.json({ base64: image.base64, mimeType: image.mimeType });
  } catch (err) {
    console.error("generate-room-image failed", err);
    const message = err instanceof Error ? err.message : "Image generation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
