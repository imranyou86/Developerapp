import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { enforceRateLimit } from "@/lib/rateLimit";
import { signStorageUrls } from "@/lib/storage";
import { toEmbeddablePhoto } from "@/lib/houseBookPdf";
import { composeMoodBoardCollage } from "@/lib/moodBoard";
import { renderMoodBoardPdf, type MoodBoardPdfRoom } from "@/lib/moodBoardPdf";
import type { MoodBoardItem } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 90;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limited = await enforceRateLimit(user.id, "mood-board-export");
  if (limited) return limited;

  const projectId = params.id;

  try {
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("name, address")
      .eq("id", projectId)
      .single();
    if (projectError || !project) {
      return NextResponse.json({ error: "Construction not found." }, { status: 404 });
    }

    const [{ data: boards }, { data: rooms }] = await Promise.all([
      supabase.from("mood_boards").select("id, room_id, notes, items, collage_image_url").eq("project_id", projectId),
      supabase.from("rooms").select("id, name").eq("project_id", projectId),
    ]);
    const roomNameById = new Map((rooms ?? []).map((r) => [r.id, r.name]));

    const rows = (boards ?? []).filter((b) => (b.items as MoodBoardItem[]).length > 0);
    if (rows.length === 0) {
      return NextResponse.json({ error: "No mood boards with items yet for this construction." }, { status: 400 });
    }

    // Every stored storage_url (per item, and the collage itself) is a
    // bucket+path encoder, not a live URL — see lib/storage.ts — so each
    // needs re-signing before this route can fetch the actual bytes.
    const itemUrls = rows.flatMap((r) => (r.items as MoodBoardItem[]).map((it) => it.storage_url));
    const collageUrls = rows.map((r) => r.collage_image_url as string | null);
    const [signedItemUrls, signedCollageUrls] = await Promise.all([signStorageUrls(itemUrls), signStorageUrls(collageUrls)]);

    let cursor = 0;
    const roomInputs: MoodBoardPdfRoom[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const items = (row.items as MoodBoardItem[]).map((it) => ({ ...it, storage_url: signedItemUrls[cursor++] ?? it.storage_url }));
      const roomName = roomNameById.get(row.room_id) ?? "Room";

      // Reuse the already-generated collage when one exists (re-encoded the
      // same way every other House Book-style image is, for safe embedding
      // in the PDF); otherwise compose one on the fly from the board's
      // current items so the export is never missing a room just because
      // nobody clicked "Generate" on it individually first.
      let collageDataUri: string | null = null;
      const existingCollageUrl = signedCollageUrls[i];
      if (existingCollageUrl) {
        collageDataUri = await toEmbeddablePhoto(existingCollageUrl);
      }
      if (!collageDataUri) {
        const png = await composeMoodBoardCollage(
          { roomName, projectName: project.name },
          items.map((it) => ({ url: it.storage_url, type: it.type, label: it.label, x: it.x, y: it.y, width: it.width, height: it.height }))
        );
        collageDataUri = `data:image/png;base64,${png.toString("base64")}`;
      }

      roomInputs.push({ roomName, notes: row.notes as string | null, collageDataUri });
    }

    const pdfBuffer = await renderMoodBoardPdf({ projectName: project.name, projectAddress: project.address, rooms: roomInputs });

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${project.name.replace(/[^a-z0-9]+/gi, "-")}-mood-boards.pdf"`,
      },
    });
  } catch (err) {
    console.error("mood-board export failed", err);
    const message = err instanceof Error ? err.message : "Could not export mood boards.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
