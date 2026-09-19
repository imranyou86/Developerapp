/* eslint-disable jsx-a11y/alt-text -- this is @react-pdf/renderer's PDF-only <Image>, not an HTML <img>; it has no alt prop */
import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import sharp from "sharp";
// @ts-expect-error - no type declarations for pdfkit's per-font subpath exports
import PdfkitHelvetica from "pdfkit/standard-fonts/Helvetica";
// @ts-expect-error - no type declarations for pdfkit's per-font subpath exports
import PdfkitTimesRoman from "pdfkit/standard-fonts/TimesRoman";
// @ts-expect-error - no type declarations for pdfkit's per-font subpath exports
import PdfkitTimesBold from "pdfkit/standard-fonts/TimesBold";
// @ts-expect-error - no type declarations for pdfkit's per-font subpath exports
import PdfkitTimesItalic from "pdfkit/standard-fonts/TimesItalic";
import { formatTimeWindow } from "@/lib/timeFormat";

// Server-only — generates a per-subcontractor "job report" PDF
// (app/api/projects/[id]/subcontractor-job-report/route.ts) that a
// Contractor/Developer can hand to a sub: every warranty request/group
// currently assigned to them on one construction, with what's scheduled and
// what needs doing. Mirrors lib/houseBookPdf.tsx's structure closely —
// same base-14-fonts-only approach and the same required pdfkit
// standard-font force-bundle imports below (see that file's own comment for
// the full explanation of why this exact same-file import is required on
// Vercel — the short version: pdfkit only reaches these modules through a
// computed require deep in its own code, which Vercel's tracing can't
// follow and webpack never sees since @react-pdf/renderer is a server
// external package; importing the literal subpath here bundles it directly
// into this route's own output instead).
void [PdfkitHelvetica, PdfkitTimesRoman, PdfkitTimesBold, PdfkitTimesItalic];

export interface JobReportTask {
  title: string;
  status: "pending" | "approved" | "rejected";
  rejectionNote: string | null;
  comment: string | null;
}

export interface JobReportRequest {
  // The group's or standalone request's own title (for a group, this is the
  // trade/category name it was filed under — see requestWarrantyItems).
  title: string;
  category: string | null;
  isGroup: boolean;
  // Only meaningful for a standalone request — a group's own status/comment
  // go unused (its tasks carry those individually).
  status: "pending" | "approved" | "rejected";
  rejectionNote: string | null;
  comment: string | null;
  progress: "open" | "in_progress" | "complete";
  scheduledDate: string | null;
  scheduledTimeStart: string | null;
  scheduledTimeEnd: string | null;
  tasks: JobReportTask[];
  photos: string[];
}

export interface JobReportInput {
  projectName: string;
  projectAddress: string | null;
  generatedAt: string;
  subcontractor: {
    company_name: string;
    trade: string | null;
    contact_name: string | null;
    phone: string | null;
    email: string | null;
  };
  requests: JobReportRequest[];
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 56,
    paddingBottom: 48,
    paddingHorizontal: 48,
    fontFamily: "Helvetica",
    fontSize: 10.5,
    color: "#2b2b2b",
  },
  header: {
    position: "absolute",
    top: 22,
    left: 48,
    right: 48,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 8.5,
    color: "#9aa0a6",
    borderBottomWidth: 0.5,
    borderBottomColor: "#dcdfe3",
    paddingBottom: 6,
  },
  footer: {
    position: "absolute",
    bottom: 22,
    left: 48,
    right: 48,
    textAlign: "center",
    fontSize: 8.5,
    color: "#9aa0a6",
  },
  kicker: {
    fontFamily: "Times-Italic",
    fontSize: 12,
    color: "#c9a24b",
    letterSpacing: 1,
    marginBottom: 6,
  },
  title: {
    fontFamily: "Times-Bold",
    fontSize: 26,
    color: "#1f2a37",
    marginBottom: 4,
  },
  address: {
    fontSize: 11,
    color: "#5b6470",
    marginBottom: 16,
  },
  subCard: {
    borderWidth: 0.75,
    borderColor: "#dcdfe3",
    borderRadius: 3,
    padding: 14,
    marginBottom: 20,
  },
  subCompany: {
    fontFamily: "Times-Bold",
    fontSize: 15,
    color: "#1f2a37",
  },
  subTrade: {
    fontSize: 9.5,
    color: "#9aa0a6",
    marginTop: 2,
    marginBottom: 6,
  },
  subContact: {
    fontSize: 10,
    color: "#5b6470",
  },
  generatedAt: {
    fontSize: 9,
    color: "#9aa0a6",
    marginBottom: 20,
  },
  categoryHeading: {
    fontFamily: "Times-Bold",
    fontSize: 15,
    color: "#1f2a37",
    marginTop: 8,
    marginBottom: 2,
  },
  categoryRule: {
    width: 30,
    height: 1.5,
    backgroundColor: "#c9a24b",
    marginBottom: 10,
  },
  requestCard: {
    borderWidth: 0.75,
    borderColor: "#dcdfe3",
    borderRadius: 3,
    padding: 12,
    marginBottom: 14,
  },
  requestTitle: {
    fontFamily: "Times-Bold",
    fontSize: 12.5,
    color: "#1f2a37",
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 4,
    marginBottom: 6,
  },
  metaLabel: {
    fontSize: 9,
    color: "#9aa0a6",
  },
  scheduledBadge: {
    fontSize: 9.5,
    color: "#8a6d1f",
    backgroundColor: "#f7ecc9",
    borderRadius: 2,
    paddingVertical: 2,
    paddingHorizontal: 6,
  },
  comment: {
    fontSize: 10,
    color: "#5b6470",
    marginTop: 4,
    marginBottom: 4,
    fontFamily: "Times-Italic",
  },
  rejectionNote: {
    fontSize: 9.5,
    color: "#a33a3a",
    marginTop: 2,
  },
  taskRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 0.5,
    borderTopColor: "#eceff2",
    paddingVertical: 6,
  },
  taskTitle: {
    fontSize: 10.5,
    color: "#2b2b2b",
  },
  taskStatus: {
    fontSize: 9,
  },
  statusPending: { color: "#8a6d1f" },
  statusApproved: { color: "#3d7a53" },
  statusRejected: { color: "#a33a3a" },
  photoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8,
  },
  photo: {
    width: 90,
    height: 90,
    objectFit: "cover",
    borderRadius: 2,
  },
  emptyState: {
    fontSize: 11,
    color: "#9aa0a6",
    marginTop: 20,
  },
});

const STATUS_LABEL: Record<JobReportTask["status"], string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

const STATUS_STYLE: Record<JobReportTask["status"], typeof styles.statusPending> = {
  pending: styles.statusPending,
  approved: styles.statusApproved,
  rejected: styles.statusRejected,
};

const PROGRESS_LABEL: Record<JobReportRequest["progress"], string> = {
  open: "Open",
  in_progress: "In progress",
  complete: "Complete",
};

function formatScheduled(req: JobReportRequest): string | null {
  if (!req.scheduledDate) return null;
  const [y, m, d] = req.scheduledDate.split("-").map(Number);
  const dateLabel = new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const windowLabel = formatTimeWindow(req.scheduledTimeStart, req.scheduledTimeEnd);
  return windowLabel ? `${dateLabel}, ${windowLabel}` : dateLabel;
}

function PageChrome({ projectName }: { projectName: string }) {
  return (
    <>
      <View style={styles.header} fixed>
        <Text>{projectName}</Text>
        <Text>Job Report</Text>
      </View>
      <Text style={styles.footer} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} fixed />
    </>
  );
}

function RequestCard({ request }: { request: JobReportRequest }) {
  const scheduled = formatScheduled(request);
  return (
    <View style={styles.requestCard} wrap={false}>
      <Text style={styles.requestTitle}>{request.title}</Text>
      <View style={styles.metaRow}>
        <Text style={styles.metaLabel}>Status: {PROGRESS_LABEL[request.progress]}</Text>
        {!request.isGroup && <Text style={[styles.metaLabel, STATUS_STYLE[request.status]]}>{STATUS_LABEL[request.status]}</Text>}
        {scheduled && <Text style={styles.scheduledBadge}>{scheduled}</Text>}
      </View>
      {request.comment && <Text style={styles.comment}>&quot;{request.comment}&quot;</Text>}
      {!request.isGroup && request.status === "rejected" && request.rejectionNote && (
        <Text style={styles.rejectionNote}>Rejected: {request.rejectionNote}</Text>
      )}
      {request.isGroup &&
        request.tasks.map((task, i) => (
          <View key={i} style={styles.taskRow}>
            <Text style={styles.taskTitle}>{task.title}</Text>
            <Text style={[styles.taskStatus, STATUS_STYLE[task.status]]}>{STATUS_LABEL[task.status]}</Text>
          </View>
        ))}
      {request.isGroup &&
        request.tasks.some((t) => t.status === "rejected" && t.rejectionNote) &&
        request.tasks
          .filter((t) => t.status === "rejected" && t.rejectionNote)
          .map((t, i) => (
            <Text key={i} style={styles.rejectionNote}>
              {t.title} rejected: {t.rejectionNote}
            </Text>
          ))}
      {request.photos.length > 0 && (
        <View style={styles.photoGrid}>
          {request.photos.map((url, i) => (
            <Image key={i} src={url} style={styles.photo} />
          ))}
        </View>
      )}
    </View>
  );
}

export function JobReportDocument({ input }: { input: JobReportInput }) {
  const { projectName, projectAddress, generatedAt, subcontractor, requests } = input;

  const byCategory = new Map<string, JobReportRequest[]>();
  for (const r of requests) {
    const key = r.category ?? "Other";
    const list = byCategory.get(key) ?? [];
    list.push(r);
    byCategory.set(key, list);
  }

  return (
    <Document title={`${projectName} — Job Report — ${subcontractor.company_name}`} author="Alaia Homes Dev">
      <Page size="LETTER" style={styles.page}>
        <PageChrome projectName={projectName} />
        <Text style={styles.kicker}>JOB REPORT</Text>
        <Text style={styles.title}>{projectName}</Text>
        {projectAddress && <Text style={styles.address}>{projectAddress}</Text>}
        <Text style={styles.generatedAt}>Generated {generatedAt}</Text>

        <View style={styles.subCard}>
          <Text style={styles.subCompany}>{subcontractor.company_name}</Text>
          {subcontractor.trade && <Text style={styles.subTrade}>{subcontractor.trade}</Text>}
          {subcontractor.contact_name && <Text style={styles.subContact}>{subcontractor.contact_name}</Text>}
          {subcontractor.phone && <Text style={styles.subContact}>{subcontractor.phone}</Text>}
          {subcontractor.email && <Text style={styles.subContact}>{subcontractor.email}</Text>}
        </View>

        {requests.length === 0 && <Text style={styles.emptyState}>No warranty requests are currently assigned to this subcontractor.</Text>}

        {Array.from(byCategory.entries()).map(([category, items]) => (
          <View key={category}>
            <Text style={styles.categoryHeading}>{category}</Text>
            <View style={styles.categoryRule} />
            {items.map((req, i) => (
              <RequestCard key={i} request={req} />
            ))}
          </View>
        ))}
      </Page>
    </Document>
  );
}

// Same reasoning as house-book's toEmbeddablePhoto/prepareImages —
// @react-pdf/renderer's <Image> sniffs raw bytes for a JPEG/PNG/SVG
// signature and crashes the whole PDF on anything else (HEIC/WEBP/GIF,
// common from phone-camera uploads to an inspection report), so every photo
// is re-encoded to a JPEG data URI up front, with a bad photo skipped
// rather than failing the report.
const MAX_EMBED_DIMENSION = 1400;

async function toEmbeddablePhoto(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const jpeg = await sharp(buffer)
      .rotate()
      .resize({ width: MAX_EMBED_DIMENSION, height: MAX_EMBED_DIMENSION, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch (err) {
    console.warn(`subcontractor-job-report: could not embed image, skipping (${url}):`, err);
    return null;
  }
}

export async function renderJobReportPdf(input: JobReportInput): Promise<Buffer> {
  const requests = await Promise.all(
    input.requests.map(async (req) => {
      const photos = (await Promise.all(req.photos.map((url) => toEmbeddablePhoto(url)))).filter((p): p is string => !!p);
      return { ...req, photos };
    })
  );
  return renderToBuffer(<JobReportDocument input={{ ...input, requests }} />);
}
