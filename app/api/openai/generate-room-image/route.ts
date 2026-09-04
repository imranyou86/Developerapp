import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateRoomImage } from "@/lib/openai";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as { prompt?: string };
  if (!body.prompt || !body.prompt.trim()) {
    return NextResponse.json({ error: "Missing image prompt." }, { status: 400 });
  }

  try {
    const image = await generateRoomImage(body.prompt);
    return NextResponse.json({ base64: image.base64, mimeType: image.mimeType });
  } catch (err) {
    console.error("generate-room-image failed", err);
    const message = err instanceof Error ? err.message : "Image generation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
