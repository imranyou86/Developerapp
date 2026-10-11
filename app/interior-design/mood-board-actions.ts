"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/app/projects/actions";
import type { MoodBoardItem } from "@/lib/types";
import { recordProjectFile, removeProjectFile } from "@/lib/projectFiles";

function revalidate(projectId: string) {
  revalidatePath(`/interior-design`);
  revalidatePath(`/projects/${projectId}/files`);
}

export interface SaveMoodBoardInput {
  roomName: string;
  notes: string | null;
  items: MoodBoardItem[];
  collageImageUrl: string | null;
}

// Upsert-by-room — one board per room (unique constraint on room_id, see
// migration 064), so every add/remove/regenerate just overwrites the same
// row's items/notes/collage rather than creating new rows.
export async function saveMoodBoard(projectId: string, roomId: string, input: SaveMoodBoardInput): Promise<ActionResult> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("mood_boards")
    .upsert(
      {
        project_id: projectId,
        room_id: roomId,
        notes: input.notes,
        items: input.items,
        collage_image_url: input.collageImageUrl,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "room_id" }
    )
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  if (input.collageImageUrl) {
    await recordProjectFile(supabase, {
      projectId,
      storageUrl: input.collageImageUrl,
      fileName: `${input.roomName} — Mood board`,
      category: "mood_board",
      sourceTable: "mood_boards",
      sourceId: data.id,
    });
  }

  revalidate(projectId);
  return { ok: true, id: data.id };
}

export async function deleteMoodBoard(projectId: string, moodBoardId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("mood_boards").delete().eq("id", moodBoardId);
  if (error) return { ok: false, error: error.message };

  await removeProjectFile(supabase, "mood_boards", moodBoardId);

  revalidate(projectId);
  return { ok: true };
}
