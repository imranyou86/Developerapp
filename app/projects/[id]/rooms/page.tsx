import { createClient } from "@/lib/supabase/server";
import { signRowsUrl } from "@/lib/storage";
import { RoomsClient } from "@/app/projects/[id]/rooms/rooms-client";

export const dynamic = "force-dynamic";

export default async function RoomsPage({ params }: { params: { id: string } }) {
  const supabase = createClient();

  const [{ data: rooms, error }, { data: planPages }] = await Promise.all([
    supabase
      .from("rooms")
      .select(
        `id, name, type, width, depth, floor, estimated,
       tasks ( id, title, due_date, done ),
       finishes ( id, name, category, brand, price ),
       renderings ( id, style, colors, description, image_prompt, illustration_svg, uploaded_photo_url, created_at )`
      )
      .eq("project_id", params.id)
      .order("floor", { ascending: true, nullsFirst: true })
      .order("name", { ascending: true }),
    // Layout pages only (not elevations) — the same filter Interior Design
    // uses to source room sizing, since those are the sheets dimensions
    // are actually drawn on.
    supabase
      .from("plan_pages")
      .select("label, storage_url")
      .eq("project_id", params.id)
      .eq("is_layout", true)
      .order("sort_order"),
  ]);

  const signedRooms = await Promise.all(
    (rooms ?? []).map(async (room) => ({
      ...room,
      renderings: await signRowsUrl(room.renderings ?? [], "uploaded_photo_url"),
    }))
  );
  const signedPlanPages = await signRowsUrl(planPages ?? [], "storage_url");

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          Could not load rooms: {error.message}
        </div>
      )}
      <RoomsClient projectId={params.id} initialRooms={signedRooms} planPages={signedPlanPages} />
    </div>
  );
}
