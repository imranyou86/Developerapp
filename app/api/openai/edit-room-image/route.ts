import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { editRoomImage } from "@/lib/openai";

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

  const body = (await req.json()) as { imageUrl?: string; prompt?: string };
  if (!body.imageUrl) {
    return NextResponse.json({ error: "Missing room photo." }, { status: 400 });
  }
  if (!body.prompt || !body.prompt.trim()) {
    return NextResponse.json({ error: "Missing design prompt." }, { status: 400 });
  }

  try {
    const image = await editRoomImage(body.imageUrl, body.prompt);
    return NextResponse.json({ base64: image.base64, mimeType: image.mimeType });
  } catch (err) {
    console.error("edit-room-image failed", err);
    const message = err instanceof Error ? err.message : "Image design failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
