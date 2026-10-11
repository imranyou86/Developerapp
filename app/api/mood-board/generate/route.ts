import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { enforceRateLimit } from "@/lib/rateLimit";
import { composeMoodBoardCollage, type MoodBoardCollageItem } from "@/lib/moodBoard";

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

  const limited = await enforceRateLimit(user.id, "mood-board-generate");
  if (limited) return limited;

  const body = (await req.json()) as { roomName?: string; projectName?: string; items?: MoodBoardCollageItem[] };
  if (!body.roomName) {
    return NextResponse.json({ error: "Missing room name." }, { status: 400 });
  }
  if (!body.items || body.items.length === 0) {
    return NextResponse.json({ error: "Add at least one inspiration photo or material first." }, { status: 400 });
  }

  try {
    const png = await composeMoodBoardCollage({ roomName: body.roomName, projectName: body.projectName }, body.items);
    return NextResponse.json({ base64: png.toString("base64"), mimeType: "image/png" });
  } catch (err) {
    console.error("mood-board generate failed", err);
    const message = err instanceof Error ? err.message : "Mood board generation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
