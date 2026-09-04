import { createClient } from "@/lib/supabase/server";
import { InteriorDesignClient } from "@/app/projects/[id]/interior-design/interior-design-client";

export const dynamic = "force-dynamic";

export default async function InteriorDesignPage({ params }: { params: { id: string } }) {
  const supabase = createClient();

  const [{ data: designs, error }, { data: rooms }] = await Promise.all([
    supabase
      .from("interior_designs")
      .select(
        "id, project_id, room_id, room_type, style, width, depth, sqft, original_photo_url, generated_image_url, prompt, created_at"
      )
      .eq("project_id", params.id)
      .order("created_at", { ascending: false }),
    supabase.from("rooms").select("id, name, type, width, depth").eq("project_id", params.id).order("name"),
  ]);

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          Could not load interior designs: {error.message}
        </div>
      )}
      <InteriorDesignClient projectId={params.id} initialDesigns={designs ?? []} rooms={rooms ?? []} />
    </div>
  );
}
