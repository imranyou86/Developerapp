import { createClient } from "@/lib/supabase/server";
import { RoomsClient } from "@/app/projects/[id]/rooms/rooms-client";

export const dynamic = "force-dynamic";

export default async function RoomsPage({ params }: { params: { id: string } }) {
  const supabase = createClient();

  const { data: rooms, error } = await supabase
    .from("rooms")
    .select(
      `id, name, type, width, depth, floor, estimated,
       tasks ( id, title, due_date, done ),
       finishes ( id, name, category, brand, price ),
       renderings ( id, style, colors, description, image_prompt, illustration_svg, uploaded_photo_url, created_at )`
    )
    .eq("project_id", params.id)
    .order("floor", { ascending: true, nullsFirst: true })
    .order("name", { ascending: true });

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          Could not load rooms: {error.message}
        </div>
      )}
      <RoomsClient projectId={params.id} initialRooms={rooms ?? []} />
    </div>
  );
}
