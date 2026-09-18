"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/app/projects/actions";

function revalidate() {
  revalidatePath("/calendar");
}

// Anyone with access to the construction can add one, except the
// 'warranty' role (view-only everywhere outside its own request queue —
// same carve-out as requireCanManageWarrantyItems). Also enforced in RLS
// (calendar_events_insert, migration 056) for defense in depth.
export async function addCalendarEvent(
  projectId: string,
  input: { title: string; notes: string | null; eventDate: string; timeStart: string | null; timeEnd: string | null }
): Promise<ActionResult> {
  if (!input.title.trim()) return { ok: false, error: "Title is required." };
  if (!input.eventDate) return { ok: false, error: "Date is required." };

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { error, data } = await supabase
    .from("calendar_events")
    .insert({
      project_id: projectId,
      title: input.title.trim(),
      notes: input.notes?.trim() || null,
      event_date: input.eventDate,
      time_start: input.timeStart || null,
      time_end: input.timeStart && input.timeEnd ? input.timeEnd : null,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  revalidate();
  return { ok: true, id: data.id };
}

// Relies on RLS (calendar_events_delete: creator or Developer) to actually
// enforce who can remove what — .select() after the delete lets this tell
// the difference between "deleted" and "RLS silently matched nothing" so
// the caller gets a real error instead of a false success.
export async function deleteCalendarEvent(eventId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { data, error } = await supabase.from("calendar_events").delete().eq("id", eventId).select("id");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: "You can only remove an item you added." };

  revalidate();
  return { ok: true };
}
