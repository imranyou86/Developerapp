import { createClient } from "@/lib/supabase/server";
import { HouseBookClient } from "@/app/projects/[id]/house-book/house-book-client";
import type { Subcontractor } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function HouseBookPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const projectId = params.id;

  const [{ data: project }, { data: planPages }, { data: rooms }, { data: interiorDesigns }, { data: landscapeDesigns }, { data: links }] =
    await Promise.all([
      supabase.from("projects").select("name, address").eq("id", projectId).single(),
      supabase
        .from("plan_pages")
        .select("id, storage_url, label")
        .eq("project_id", projectId)
        .eq("is_layout", true)
        .order("sort_order"),
      supabase.from("rooms").select("id, name").eq("project_id", projectId).order("name"),
      supabase
        .from("interior_designs")
        .select("id, room_type, style, generated_image_url")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false }),
      supabase
        .from("landscape_designs")
        .select("id, style, generated_image_url")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false }),
      supabase.from("project_subcontractors").select("subcontractors(*)").eq("project_id", projectId),
    ]);

  const roomList = rooms ?? [];
  let renderingsByRoom: { id: string; roomName: string; style: string; uploaded_photo_url: string }[] = [];
  if (roomList.length > 0) {
    const { data: renderings } = await supabase
      .from("renderings")
      .select("id, room_id, style, uploaded_photo_url")
      .in(
        "room_id",
        roomList.map((r) => r.id)
      )
      .not("uploaded_photo_url", "is", null)
      .order("created_at", { ascending: false });
    const roomNameById = new Map(roomList.map((r) => [r.id, r.name]));
    renderingsByRoom = (renderings ?? []).map((r) => ({
      id: r.id,
      roomName: roomNameById.get(r.room_id) ?? "Room",
      style: r.style,
      uploaded_photo_url: r.uploaded_photo_url as string,
    }));
  }

  // project_subcontractors rows point at a subcontractor that may since have
  // been deleted (on delete cascade removes the link too, but a null guard
  // here costs nothing and Supabase's typed join return is nullable anyway).
  const subcontractors = (links ?? [])
    .map((l) => l.subcontractors as unknown as Subcontractor | null)
    .filter((s): s is Subcontractor => s != null);

  return (
    <HouseBookClient
      projectId={projectId}
      projectName={project?.name ?? "Construction"}
      projectAddress={project?.address ?? null}
      planPages={planPages ?? []}
      roomImages={renderingsByRoom}
      interiorDesigns={interiorDesigns ?? []}
      landscapeDesigns={landscapeDesigns ?? []}
      subcontractors={subcontractors}
    />
  );
}
