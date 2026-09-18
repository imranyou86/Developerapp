"use client";

// Shared by the Contractor/Developer/PM "Generate checklist items" flow
// (app/projects/[id]/warranty-request/warranty-request-client.tsx) and the
// homeowner's "Upload an inspection report" flow
// (app/projects/[id]/warranty-request/warranty-inspection-upload.tsx) — both
// read an already-uploaded report file and run it through the same Claude
// extraction route; they differ only in what they do with the results
// (direct checklist items for a manager vs. pending requests for a
// homeowner).

import { createClient } from "@/lib/supabase/client";
import { fetchWithRetry } from "@/lib/fetchWithRetry";
import { SIGNED_URL_TTL_SECONDS } from "@/lib/storageClient";

export const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "heic", "heif", "gif"];

export function fileExtension(fileName: string): string {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

export function isExtractableReport(fileName: string): boolean {
  const ext = fileExtension(fileName);
  return ext === "pdf" || IMAGE_EXTENSIONS.includes(ext);
}

export interface ExtractedFinding {
  title: string;
  detail: string | null;
  category: string | null;
}

// Reads a report's stored file directly by URL (works for a report
// uploaded just now or one uploaded long ago) — a PDF gets its text
// extracted with pdf.js, falling back to rendered page images for a
// scanned/image-only PDF, same approach the Bids tab uses for reading
// contractor bids; an image file goes straight through as-is.
async function readReportForExtraction(
  supabase: ReturnType<typeof createClient>,
  projectId: string,
  report: { file_name: string; storage_url: string },
  setStatus: (s: string) => void
): Promise<{ text?: string; pageImageUrls?: string[] }> {
  const ext = fileExtension(report.file_name);
  if (ext !== "pdf") {
    setStatus("Reading photo…");
    return { pageImageUrls: [report.storage_url] };
  }

  setStatus("Reading PDF…");
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const pdf = await pdfjsLib.getDocument({ url: report.storage_url }).promise;

  let fullText = "";
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((it) => ("str" in it ? it.str : "")).join(" ");
    fullText += `\n\n--- Page ${pageNum} ---\n${pageText}`;
  }

  if (fullText.trim().length > 50) {
    return { text: fullText };
  }

  // Likely a scanned/image-only PDF — render pages as images instead.
  setStatus("Report looks scanned — rendering pages for image-based reading…");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const pageImageUrls: string[] = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas rendering is not supported in this browser.");
    await page.render({ canvasContext: context, viewport }).promise;
    const blob: Blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode page image."))), "image/png")
    );
    const imgPath = `${user.id}/${projectId}/${Date.now()}-p${pageNum}-${report.file_name}.png`;
    const { error: imgUploadError } = await supabase.storage.from("project-files").upload(imgPath, blob, {
      contentType: "image/png",
    });
    if (imgUploadError) throw new Error(imgUploadError.message);
    const { data: imgPub, error: imgPubSignError } = await supabase.storage
      .from("project-files")
      .createSignedUrl(imgPath, SIGNED_URL_TTL_SECONDS);
    if (imgPubSignError || !imgPub) throw new Error(imgPubSignError?.message ?? "Could not get a URL for the uploaded file.");
    pageImageUrls.push(imgPub.signedUrl);
  }
  return { pageImageUrls };
}

// Reads the report and runs it through /api/claude/extract-inspection-report
// end to end — the one function both upload flows call.
export async function extractFindingsFromReport(
  projectId: string,
  report: { file_name: string; storage_url: string },
  setStatus: (s: string) => void
): Promise<ExtractedFinding[]> {
  const ext = fileExtension(report.file_name);
  if (ext !== "pdf" && !IMAGE_EXTENSIONS.includes(ext)) {
    throw new Error("Automatic extraction only works for PDF or photo reports.");
  }

  const supabase = createClient();
  const requestBody = await readReportForExtraction(supabase, projectId, report, setStatus);

  setStatus("Finding issues to add…");
  const res = await fetchWithRetry("/api/claude/extract-inspection-report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Could not read this report.");

  return (json.items ?? []) as ExtractedFinding[];
}
