import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient, CLAUDE_MODEL } from "@/lib/anthropic";
import { renderHouseBookPdf, type HouseBookSubcontractor } from "@/lib/houseBookPdf";

export const runtime = "nodejs";
export const maxDuration = 60;

interface HouseBookRequest {
  planPageIds?: string[];
  roomImageIds?: string[];
  interiorDesignIds?: string[];
  landscapeIds?: string[];
  subcontractorIds?: string[];
  includeClosingNote?: boolean;
}

async function writeClosingNote(input: {
  projectName: string;
  projectAddress: string | null;
  roomLabels: string[];
  landscapeStyles: string[];
  trades: string[];
}): Promise<string> {
  const anthropic = getAnthropicClient();
  const facts = [
    `Construction: ${input.projectName}${input.projectAddress ? ` — ${input.projectAddress}` : ""}`,
    input.roomLabels.length > 0 && `Rooms/finishes styled: ${input.roomLabels.join("; ")}`,
    input.landscapeStyles.length > 0 && `Landscape style: ${input.landscapeStyles.join(", ")}`,
    input.trades.length > 0 && `Trades on the project: ${input.trades.join(", ")}`,
  ]
    .filter(Boolean)
    .join("\n");

  const message = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 700,
    output_config: { effort: "low" },
    system: `You write short, warm closing notes for a "House Book" — a keepsake PDF a homeowner
receives at the end of their construction, summarizing the plans, finishes, and team behind their
new home. Write 2-3 short paragraphs (150-250 words total), plain prose (no headings, no bullet
points, no markdown), addressed warmly to the homeowner about the home they're moving into —
grounded only in the facts given, never inventing specific details (materials, dates, people) not
provided. If few facts are given, keep it general and sincere rather than padding with invented
specifics. Do not include a greeting like "Dear..." or a sign-off/signature — it stands alone as a
closing page. Return only the note text, nothing else.`,
    messages: [{ role: "user", content: `Facts about this construction:\n${facts || "(no further details provided)"}` }],
  });

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") throw new Error("No text response from Claude.");
  return textBlock.text.trim();
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projectId = params.id;
  const body = (await req.json().catch(() => ({}))) as HouseBookRequest;
  const planPageIds = body.planPageIds ?? [];
  const roomImageIds = body.roomImageIds ?? [];
  const interiorDesignIds = body.interiorDesignIds ?? [];
  const landscapeIds = body.landscapeIds ?? [];
  const subcontractorIds = body.subcontractorIds ?? [];
  const includeClosingNote = !!body.includeClosingNote;

  try {
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("name, address")
      .eq("id", projectId)
      .single();
    if (projectError || !project) return NextResponse.json({ error: "Construction not found." }, { status: 404 });

    // Every query below is re-scoped to this project server-side rather than
    // trusting the id lists the client sent — RLS already prevents reading
    // another project's rows, but this also guards against a stale id (e.g.
    // switched projects mid-session) silently pulling in the wrong content.
    const [{ data: planPages }, { data: rooms }, { data: interiorDesigns }, { data: landscapeDesigns }, { data: links }] = await Promise.all([
      planPageIds.length > 0
        ? supabase.from("plan_pages").select("storage_url, label, sort_order").eq("project_id", projectId).in("id", planPageIds).order("sort_order")
        : Promise.resolve({ data: [] as { storage_url: string; label: string; sort_order: number }[] }),
      supabase.from("rooms").select("id, name").eq("project_id", projectId),
      interiorDesignIds.length > 0
        ? supabase.from("interior_designs").select("room_type, style, generated_image_url").eq("project_id", projectId).in("id", interiorDesignIds)
        : Promise.resolve({ data: [] as { room_type: string; style: string; generated_image_url: string }[] }),
      landscapeIds.length > 0
        ? supabase.from("landscape_designs").select("style, generated_image_url").eq("project_id", projectId).in("id", landscapeIds)
        : Promise.resolve({ data: [] as { style: string; generated_image_url: string }[] }),
      // Plain columns + a manual join below, not a nested `subcontractors(*)`
      // embed — same reasoning as house-book/page.tsx's identical query.
      subcontractorIds.length > 0
        ? supabase.from("project_subcontractors").select("subcontractor_id").eq("project_id", projectId)
        : Promise.resolve({ data: [] as { subcontractor_id: string }[] }),
    ]);

    const roomIds = new Set((rooms ?? []).map((r) => r.id));
    const roomNameById = new Map((rooms ?? []).map((r) => [r.id, r.name]));
    let roomImages: { style: string; uploaded_photo_url: string; room_id: string }[] = [];
    if (roomImageIds.length > 0) {
      const { data: renderings } = await supabase
        .from("renderings")
        .select("style, uploaded_photo_url, room_id")
        .in("id", roomImageIds)
        .not("uploaded_photo_url", "is", null);
      roomImages = (renderings ?? []).filter((r) => roomIds.has(r.room_id)) as typeof roomImages;
    }

    const allowedSubIds = new Set((links ?? []).map((l) => l.subcontractor_id));
    let subcontractors: HouseBookSubcontractor[] = [];
    if (subcontractorIds.length > 0) {
      const wanted = subcontractorIds.filter((id) => allowedSubIds.has(id));
      if (wanted.length > 0) {
        const { data } = await supabase
          .from("subcontractors")
          .select("company_name, trade, contact_name, phone, email, license_number, license_state, license_status")
          .in("id", wanted);
        subcontractors = (data ?? []) as HouseBookSubcontractor[];
      }
    }

    const images = [
      ...roomImages.map((r) => ({ url: r.uploaded_photo_url, caption: `${roomNameById.get(r.room_id) ?? "Room"} — ${r.style}` })),
      ...(interiorDesigns ?? []).map((d) => ({ url: d.generated_image_url, caption: `${d.room_type} — ${d.style}` })),
    ];
    const landscape = (landscapeDesigns ?? []).map((l) => ({ url: l.generated_image_url, caption: l.style }));

    if (images.length === 0 && landscape.length === 0 && (planPages ?? []).length === 0 && subcontractors.length === 0 && !includeClosingNote) {
      return NextResponse.json({ error: "Nothing selected to include." }, { status: 400 });
    }

    let closingNote: string | null = null;
    if (includeClosingNote) {
      try {
        closingNote = await writeClosingNote({
          projectName: project.name,
          projectAddress: project.address,
          roomLabels: images.map((i) => i.caption),
          landscapeStyles: landscape.map((l) => l.caption),
          trades: subcontractors.map((s) => s.trade).filter((t): t is string => !!t),
        });
      } catch (err) {
        console.warn("house-book: closing note generation failed, continuing without it:", err);
      }
    }

    const pdfBuffer = await renderHouseBookPdf({
      projectName: project.name,
      projectAddress: project.address,
      planPages: (planPages ?? []).map((p) => ({ url: p.storage_url, caption: p.label })),
      images,
      landscape,
      subcontractors,
      closingNote,
    });

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${project.name.replace(/[^a-z0-9]+/gi, "-")}-house-book.pdf"`,
      },
    });
  } catch (err) {
    console.error("house-book generation failed", err);
    const message = err instanceof Error ? err.message : "Could not generate the House Book.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
