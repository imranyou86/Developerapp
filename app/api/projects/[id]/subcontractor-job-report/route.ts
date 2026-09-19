import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { enforceRateLimit } from "@/lib/rateLimit";
import { signStorageUrls } from "@/lib/storage";
import { renderJobReportPdf, type JobReportRequest } from "@/lib/subcontractorJobReportPdf";

export const runtime = "nodejs";
export const maxDuration = 60;

const REPORT_IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "heic", "heif", "gif"];
function isImageFile(fileName: string): boolean {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return REPORT_IMAGE_EXTENSIONS.includes(ext);
}

interface RequestRow {
  id: string;
  title: string;
  category: string | null;
  is_group: boolean;
  group_id: string | null;
  status: "pending" | "approved" | "rejected";
  rejection_note: string | null;
  comment: string | null;
  progress: "open" | "in_progress" | "complete";
  scheduled_date: string | null;
  scheduled_time_start: string | null;
  scheduled_time_end: string | null;
}

const REQUEST_COLUMNS =
  "id, title, category, is_group, group_id, status, rejection_note, comment, progress, scheduled_date, scheduled_time_start, scheduled_time_end";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Only a Contractor, Developer, or PM manages warranty requests and would
  // hand a job report to a subcontractor — same boundary as
  // requireApprover() in app/projects/[id]/warranty-request/actions.ts.
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (!profile || !["contractor", "developer", "pm"].includes(profile.role)) {
    return NextResponse.json({ error: "Only a Contractor, Developer, or PM can generate a job report." }, { status: 403 });
  }

  const limited = await enforceRateLimit(user.id, "subcontractor-job-report");
  if (limited) return limited;

  const projectId = params.id;
  const body = (await req.json().catch(() => ({}))) as { subcontractorId?: string };
  const subcontractorId = body.subcontractorId;
  if (!subcontractorId) return NextResponse.json({ error: "No subcontractor selected." }, { status: 400 });

  try {
    const [{ data: project, error: projectError }, { data: subcontractor, error: subError }] = await Promise.all([
      supabase.from("projects").select("name, address").eq("id", projectId).single(),
      // Not scoped to project_subcontractors here — same as
      // assignWarrantyRequestSubcontractor, a request can be assigned any
      // subcontractor from the shared directory, whether or not it's been
      // formally linked to this construction via that table.
      supabase.from("subcontractors").select("company_name, trade, contact_name, phone, email").eq("id", subcontractorId).single(),
    ]);
    if (projectError || !project) return NextResponse.json({ error: "Construction not found." }, { status: 404 });
    if (subError || !subcontractor) return NextResponse.json({ error: "Subcontractor not found." }, { status: 404 });

    const { data: topLevel } = await supabase
      .from("warranty_item_requests")
      .select(REQUEST_COLUMNS)
      .eq("project_id", projectId)
      .eq("subcontractor_id", subcontractorId)
      .is("group_id", null)
      .order("category", { ascending: true, nullsFirst: false });
    const topLevelRows = (topLevel ?? []) as RequestRow[];

    const groupIds = topLevelRows.filter((r) => r.is_group).map((r) => r.id);
    let childRows: RequestRow[] = [];
    if (groupIds.length > 0) {
      const { data: children } = await supabase.from("warranty_item_requests").select(REQUEST_COLUMNS).in("group_id", groupIds);
      childRows = (children ?? []) as RequestRow[];
    }

    const allIds = [...topLevelRows.map((r) => r.id), ...childRows.map((r) => r.id)];
    let reports: { warranty_item_request_id: string | null; file_name: string; storage_url: string }[] = [];
    let noteRows: { request_id: string; sender_name: string | null; sender_email: string; body: string }[] = [];
    if (allIds.length > 0) {
      const [{ data: reportData }, { data: commentData }] = await Promise.all([
        supabase.from("inspection_reports").select("warranty_item_request_id, file_name, storage_url").in("warranty_item_request_id", allIds),
        supabase
          .from("warranty_item_request_comments")
          .select("request_id, sender_name, sender_email, body, created_at")
          .in("request_id", allIds)
          .order("created_at", { ascending: true }),
      ]);
      reports = (reportData ?? []).filter((r) => isImageFile(r.file_name));
      noteRows = commentData ?? [];
    }
    const signedUrls = await signStorageUrls(reports.map((r) => r.storage_url));
    const photosByRequestId = new Map<string, string[]>();
    reports.forEach((r, i) => {
      const url = signedUrls[i];
      if (!url || !r.warranty_item_request_id) return;
      const list = photosByRequestId.get(r.warranty_item_request_id) ?? [];
      list.push(url);
      photosByRequestId.set(r.warranty_item_request_id, list);
    });
    const notesByRequestId = new Map<string, { author: string; body: string }[]>();
    for (const c of noteRows) {
      const list = notesByRequestId.get(c.request_id) ?? [];
      list.push({ author: c.sender_name || c.sender_email, body: c.body });
      notesByRequestId.set(c.request_id, list);
    }

    const childrenByParentId = new Map<string, RequestRow[]>();
    for (const child of childRows) {
      if (!child.group_id) continue;
      const list = childrenByParentId.get(child.group_id) ?? [];
      list.push(child);
      childrenByParentId.set(child.group_id, list);
    }

    // Each row's own photos/notes only — a group's shared evidence stays on
    // the group, and each task carries just its own (attached to the task's
    // own id via the "+ Add photo"/note UI on GroupTaskRow), rather than
    // flattening everything up to the group level.
    const requests: JobReportRequest[] = topLevelRows.map((row) => {
      const children = row.is_group ? childrenByParentId.get(row.id) ?? [] : [];
      return {
        title: row.title,
        category: row.category,
        isGroup: row.is_group,
        status: row.status,
        rejectionNote: row.rejection_note,
        comment: row.comment,
        progress: row.progress,
        scheduledDate: row.scheduled_date,
        scheduledTimeStart: row.scheduled_time_start,
        scheduledTimeEnd: row.scheduled_time_end,
        tasks: children.map((c) => ({
          title: c.title,
          status: c.status,
          rejectionNote: c.rejection_note,
          comment: c.comment,
          photos: photosByRequestId.get(c.id) ?? [],
          notes: notesByRequestId.get(c.id) ?? [],
        })),
        photos: photosByRequestId.get(row.id) ?? [],
        notes: notesByRequestId.get(row.id) ?? [],
      };
    });

    const pdfBuffer = await renderJobReportPdf({
      projectName: project.name,
      projectAddress: project.address,
      generatedAt: new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }),
      subcontractor,
      requests,
    });

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${subcontractor.company_name.replace(/[^a-z0-9]+/gi, "-")}-job-report.pdf"`,
      },
    });
  } catch (err) {
    console.error("subcontractor-job-report generation failed", err);
    const message = err instanceof Error ? err.message : "Could not generate the job report.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
