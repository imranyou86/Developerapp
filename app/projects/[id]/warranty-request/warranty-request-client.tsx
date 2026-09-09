"use client";

import { useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/Toast";
import { useBackgroundTasks } from "@/components/BackgroundTasks";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { fetchWithRetry } from "@/lib/fetchWithRetry";
import {
  addInspectionReport,
  addWarrantyItem,
  addWarrantyItemsFromReport,
  addWarrantyPhoto,
  approveWarrantyItemRequest,
  attachInspectionReport,
  deleteInspectionReport,
  deleteWarrantyItem,
  deleteWarrantyPhoto,
  rejectWarrantyItemRequest,
  requestWarrantyItem,
  setWarrantyStatus,
  toggleWarrantyItem,
  updateWarrantyComment,
  type CreatedWarrantyItem,
} from "@/app/projects/[id]/warranty-request/actions";
import type { UserRole, WarrantyItemRequest, WarrantyItemStatus } from "@/lib/types";

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "heic", "heif", "gif"];

function fileExtension(fileName: string): string {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

interface WarrantyPhoto {
  id: string;
  storage_url: string;
}

interface WarrantyItemRow {
  id: string;
  title: string;
  done: boolean;
  status: WarrantyItemStatus;
  comment: string | null;
  sort_order: number;
  checklist_photos: WarrantyPhoto[];
}

interface InspectionReportRow {
  id: string;
  project_id: string;
  checklist_item_id: string | null;
  file_name: string;
  storage_url: string;
  created_at: string;
}

export function WarrantyRequestClient({
  projectId,
  initialItems,
  initialReports,
  initialRequests,
  viewerRole,
}: {
  projectId: string;
  initialItems: WarrantyItemRow[];
  initialReports: InspectionReportRow[];
  initialRequests: WarrantyItemRequest[];
  viewerRole: UserRole;
}) {
  const { notify } = useToast();
  const [items, setItems] = useState<WarrantyItemRow[]>(initialItems);
  const [reports, setReports] = useState<InspectionReportRow[]>(initialReports);
  const [requests, setRequests] = useState<WarrantyItemRequest[]>(initialRequests);
  const [newTitle, setNewTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const fixed = items.filter((i) => i.done).length;
  // The 'warranty' role can watch checklist items, notes, and photos here
  // and chat about them, but can't mutate anything directly — they file a
  // request instead, which a Contractor or Developer approves or rejects.
  const canManage = viewerRole !== "warranty";
  const canApprove = viewerRole === "contractor" || viewerRole === "developer";

  function updateItem(id: string, patch: Partial<WarrantyItemRow>) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }
  function removeItem(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
    // Mirrors the DB's "on delete set null" on inspection_reports.checklist_item_id —
    // a report attached to a deleted item goes back to unattached, not orphaned.
    setReports((prev) => prev.map((r) => (r.checklist_item_id === id ? { ...r, checklist_item_id: null } : r)));
  }
  function updateReport(id: string, patch: Partial<InspectionReportRow>) {
    setReports((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function removeReport(id: string) {
    setReports((prev) => prev.filter((r) => r.id !== id));
  }
  function addGeneratedItems(newItems: CreatedWarrantyItem[]) {
    setItems((prev) => [
      ...prev,
      ...newItems.map((it, i) => ({
        id: it.id,
        title: it.title,
        done: false,
        status: "pending" as const,
        comment: it.comment,
        sort_order: prev.length + i,
        checklist_photos: [],
      })),
    ]);
  }

  async function handleAdd() {
    if (!newTitle.trim()) return;
    setAdding(true);
    const res = await addWarrantyItem(projectId, newTitle);
    if (!res.ok || !res.id) {
      notify("error", res.error ?? "Could not add item.");
    } else {
      setItems((prev) => [
        ...prev,
        {
          id: res.id!,
          title: newTitle.trim(),
          done: false,
          status: "pending",
          comment: null,
          sort_order: prev.length,
          checklist_photos: [],
        },
      ]);
      setNewTitle("");
    }
    setAdding(false);
  }

  async function handleAttach(reportId: string, checklistItemId: string | null) {
    const previous = reports.find((r) => r.id === reportId)?.checklist_item_id ?? null;
    updateReport(reportId, { checklist_item_id: checklistItemId });
    const res = await attachInspectionReport(projectId, reportId, checklistItemId);
    if (!res.ok) {
      notify("error", res.error ?? "Could not update attachment.");
      updateReport(reportId, { checklist_item_id: previous });
    }
  }

  async function handleRequest(title: string, comment: string) {
    if (!title.trim()) return;
    setAdding(true);
    const res = await requestWarrantyItem(projectId, title, comment);
    if (!res.ok || !res.id) {
      notify("error", res.error ?? "Could not submit request.");
    } else {
      setRequests((prev) => [
        {
          id: res.id!,
          project_id: projectId,
          title: title.trim(),
          comment: comment.trim() || null,
          requested_by: "",
          status: "pending",
          checklist_item_id: null,
          reviewed_by: null,
          reviewed_at: null,
          created_at: new Date().toISOString(),
        },
        ...prev,
      ]);
      notify("success", "Request submitted — a Contractor or Developer will review it.");
    }
    setAdding(false);
  }

  async function handleApprove(request: WarrantyItemRequest) {
    const res = await approveWarrantyItemRequest(projectId, request.id);
    if (!res.ok || !res.id) {
      notify("error", res.error ?? "Could not approve request.");
      return;
    }
    setRequests((prev) =>
      prev.map((r) => (r.id === request.id ? { ...r, status: "approved", checklist_item_id: res.id! } : r))
    );
    addGeneratedItems([{ id: res.id, title: request.title, comment: request.comment }]);
  }

  async function handleReject(request: WarrantyItemRequest) {
    const res = await rejectWarrantyItemRequest(projectId, request.id);
    if (!res.ok) {
      notify("error", res.error ?? "Could not reject request.");
      return;
    }
    setRequests((prev) => prev.map((r) => (r.id === request.id ? { ...r, status: "rejected" } : r)));
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <InspectionReportsSection
        projectId={projectId}
        reports={reports}
        items={items}
        canManage={canManage}
        onAdd={(r) => setReports((prev) => [r, ...prev])}
        onAttach={handleAttach}
        onRemove={removeReport}
        onItemsGenerated={addGeneratedItems}
      />

      <div className="card p-5">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="font-semibold text-blueprint-dark">Warranty Request</h2>
          <span className="text-xs text-blueprint/50">
            {fixed}/{items.length} fixed
          </span>
        </div>
        <p className="mb-4 text-sm text-blueprint/60">
          {canManage
            ? "List anything that needs to be fixed under warranty, one item at a time — each becomes a checklist item the team can track through to done."
            : "Here's everything filed under warranty and where it stands. To add something new, submit a request below — a Contractor or Developer reviews it before it's added."}
        </p>

        <div className="h-1.5 w-full overflow-hidden rounded-full bg-concrete">
          <div
            className="h-full bg-sage transition-all duration-500 ease-out"
            style={{ width: items.length ? `${(fixed / items.length) * 100}%` : "0%" }}
          />
        </div>

        <div className="mt-4 space-y-2">
          {items.length === 0 && <p className="text-sm text-blueprint/40">No warranty items yet.</p>}
          {items.map((item, i) => (
            <div key={item.id} className="animate-fade-in-up" style={{ animationDelay: `${Math.min(i * 30, 300)}ms` }}>
              <WarrantyItem
                projectId={projectId}
                item={item}
                reports={reports.filter((r) => r.checklist_item_id === item.id)}
                canManage={canManage}
                onUpdate={updateItem}
                onRemove={removeItem}
                onDetachReport={(reportId) => handleAttach(reportId, null)}
              />
            </div>
          ))}
        </div>

        {canManage && (
          <div className="mt-3 flex gap-2">
            <input
              className="input flex-1"
              placeholder="Describe the issue — e.g. &quot;Leaky faucet in kitchen&quot;"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            />
            <button className="btn-outline" onClick={handleAdd} disabled={adding || !newTitle.trim()}>
              Add
            </button>
          </div>
        )}
      </div>

      <RequestsSection requests={requests} canManage={canManage} canApprove={canApprove} onRequest={handleRequest} onApprove={handleApprove} onReject={handleReject} />
    </div>
  );
}

function RequestsSection({
  requests,
  canManage,
  canApprove,
  onRequest,
  onApprove,
  onReject,
}: {
  requests: WarrantyItemRequest[];
  canManage: boolean;
  canApprove: boolean;
  onRequest: (title: string, comment: string) => Promise<void>;
  onApprove: (request: WarrantyItemRequest) => Promise<void>;
  onReject: (request: WarrantyItemRequest) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const pending = requests.filter((r) => r.status === "pending");
  const reviewed = requests.filter((r) => r.status !== "pending");

  async function handleSubmit() {
    if (!title.trim()) return;
    setSubmitting(true);
    await onRequest(title, comment);
    setTitle("");
    setComment("");
    setSubmitting(false);
  }

  if (requests.length === 0 && canManage) return null;

  return (
    <div className="card p-5">
      <h2 className="mb-1 font-semibold text-blueprint-dark">Warranty Item Requests</h2>
      <p className="mb-4 text-sm text-blueprint/60">
        {canApprove
          ? "Requests filed by a warranty account, awaiting your approval before they're added as a warranty item."
          : "Items requested but not yet added to the warranty list above."}
      </p>

      {pending.length === 0 ? (
        <p className="text-sm text-blueprint/40">No pending requests.</p>
      ) : (
        <div className="space-y-2">
          {pending.map((request) => (
            <div key={request.id} className="rounded-lg border border-amber/30 bg-amber/5 p-2.5 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-blueprint-dark">{request.title}</p>
                  {request.comment && <p className="mt-0.5 text-xs text-blueprint/60">{request.comment}</p>}
                </div>
                {canApprove && (
                  <div className="flex shrink-0 gap-2">
                    <button
                      className="text-xs text-sage-dark hover:underline"
                      disabled={actingOn === request.id}
                      onClick={async () => {
                        setActingOn(request.id);
                        await onApprove(request);
                        setActingOn(null);
                      }}
                    >
                      Approve
                    </button>
                    <button
                      className="text-xs text-red-500 hover:underline"
                      disabled={actingOn === request.id}
                      onClick={async () => {
                        setActingOn(request.id);
                        await onReject(request);
                        setActingOn(null);
                      }}
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {reviewed.length > 0 && (
        <div className="mt-3 space-y-1 border-t border-blueprint/10 pt-2">
          {reviewed.map((request) => (
            <div key={request.id} className="flex items-center justify-between text-xs text-blueprint/50">
              <span className={request.status === "rejected" ? "line-through" : ""}>{request.title}</span>
              <span className={request.status === "approved" ? "text-sage-dark" : "text-red-500"}>{request.status}</span>
            </div>
          ))}
        </div>
      )}

      {!canManage && (
        <div className="mt-4 space-y-2 border-t border-blueprint/10 pt-3">
          <input
            className="input"
            placeholder="Describe the issue — e.g. &quot;Leaky faucet in kitchen&quot;"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <textarea
            className="input"
            rows={2}
            placeholder="Additional details (optional)…"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <button className="btn-outline" onClick={handleSubmit} disabled={submitting || !title.trim()}>
            Submit request
          </button>
        </div>
      )}
    </div>
  );
}

function InspectionReportsSection({
  projectId,
  reports,
  items,
  canManage,
  onAdd,
  onAttach,
  onRemove,
  onItemsGenerated,
}: {
  projectId: string;
  reports: InspectionReportRow[];
  items: WarrantyItemRow[];
  canManage: boolean;
  onAdd: (report: InspectionReportRow) => void;
  onAttach: (reportId: string, checklistItemId: string | null) => void;
  onRemove: (id: string) => void;
  onItemsGenerated: (items: CreatedWarrantyItem[]) => void;
}) {
  const { notify } = useToast();
  const { run, isRunning } = useBackgroundTasks();
  const uploadTaskKey = "inspection-report-upload";
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<InspectionReportRow | null>(null);
  const [generatingStatus, setGeneratingStatus] = useState<Record<string, string>>({});

  async function handleUpload(file: File) {
    setUploading(true);
    try {
      await run(uploadTaskKey, `Uploading "${file.name}"…`, async () => {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error("Not signed in.");

        const path = `${user.id}/${projectId}/${Date.now()}-${file.name}`;
        const { error: uploadError } = await supabase.storage.from("project-files").upload(path, file, {
          contentType: file.type || "application/octet-stream",
        });
        if (uploadError) throw new Error(uploadError.message);

        const { data: pub } = supabase.storage.from("project-files").getPublicUrl(path);
        const res = await addInspectionReport(projectId, file.name, pub.publicUrl);
        if (!res.ok || !res.id) throw new Error(res.error ?? "Could not save report.");

        onAdd({
          id: res.id,
          project_id: projectId,
          checklist_item_id: null,
          file_name: file.name,
          storage_url: pub.publicUrl,
          created_at: new Date().toISOString(),
        });
        notify("success", `Uploaded "${file.name}".`);
      });
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  // Reads the report's stored file directly by URL (works for a report
  // uploaded just now or one uploaded long ago) — a PDF gets its text
  // extracted with pdf.js, falling back to rendered page images for a
  // scanned/image-only PDF, same approach the Bids tab uses for reading
  // contractor bids; an image file goes straight to Claude as-is.
  async function handleGenerateItems(report: InspectionReportRow) {
    const setStatus = (s: string) => setGeneratingStatus((prev) => ({ ...prev, [report.id]: s }));
    const ext = fileExtension(report.file_name);
    if (ext !== "pdf" && !IMAGE_EXTENSIONS.includes(ext)) {
      notify("error", "Automatic checklist generation only works for PDF or photo reports.");
      return;
    }

    const taskKey = `inspection-extract:${report.id}`;
    try {
      await run(taskKey, `Reading "${report.file_name}"…`, async () => {
        let requestBody: { text?: string; pageImageUrls?: string[] };

        if (ext === "pdf") {
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
            requestBody = { text: fullText };
          } else {
            // Likely a scanned/image-only PDF — render pages as images instead.
            setStatus("Report looks scanned — rendering pages for image-based reading…");
            const supabase = createClient();
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
              const { data: imgPub } = supabase.storage.from("project-files").getPublicUrl(imgPath);
              pageImageUrls.push(imgPub.publicUrl);
            }
            requestBody = { pageImageUrls };
          }
        } else {
          setStatus("Reading photo…");
          requestBody = { pageImageUrls: [report.storage_url] };
        }

        setStatus("Finding issues to add…");
        const res = await fetchWithRetry("/api/claude/extract-inspection-report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Could not read this report.");

        const findings: { title: string; detail: string | null }[] = json.items ?? [];
        if (findings.length === 0) {
          notify("success", "No actionable issues found in this report.");
          return;
        }

        const addRes = await addWarrantyItemsFromReport(projectId, findings);
        if (!addRes.ok || !addRes.items) throw new Error(addRes.error ?? "Could not add items.");

        onItemsGenerated(addRes.items);
        notify("success", `Added ${addRes.items.length} item${addRes.items.length === 1 ? "" : "s"} from "${report.file_name}".`);
      });
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Could not read this report.");
    } finally {
      setGeneratingStatus((prev) => {
        const next = { ...prev };
        delete next[report.id];
        return next;
      });
    }
  }

  return (
    <div className="card p-5">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-semibold text-blueprint-dark">Inspection Reports</h2>
        {canManage && (
          <label className="btn-outline cursor-pointer text-xs">
            {uploading || isRunning(uploadTaskKey) ? "Uploading…" : "+ Upload report"}
            <input
              type="file"
              accept="application/pdf,image/*,.doc,.docx"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleUpload(file);
                e.target.value = "";
              }}
            />
          </label>
        )}
      </div>
      <p className="mb-3 text-sm text-blueprint/60">
        Upload an inspector&apos;s report, then attach it to the warranty item it applies to.
      </p>

      {reports.length === 0 ? (
        <p className="text-sm text-blueprint/40">No inspection reports uploaded yet.</p>
      ) : (
        <div className="space-y-1">
          {reports.map((report, i) => {
            const status = generatingStatus[report.id];
            return (
              <div
                key={report.id}
                className="animate-fade-in-up rounded-lg border border-blueprint/10 p-2 text-sm"
                style={{ animationDelay: `${Math.min(i * 30, 300)}ms` }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={report.storage_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 truncate text-blueprint-dark hover:text-amber hover:underline"
                  >
                    📄 {report.file_name}
                  </a>
                  {canManage ? (
                    <select
                      className="input w-auto text-xs"
                      value={report.checklist_item_id ?? ""}
                      onChange={(e) => onAttach(report.id, e.target.value || null)}
                    >
                      <option value="">Not attached</option>
                      {items.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.title}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-xs text-blueprint/50">
                      {items.find((item) => item.id === report.checklist_item_id)?.title ?? "Not attached"}
                    </span>
                  )}
                  {canManage && (
                    <>
                      <button
                        className="btn-ghost text-xs"
                        onClick={() => handleGenerateItems(report)}
                        disabled={!!status}
                      >
                        {status ?? "Generate checklist items"}
                      </button>
                      <button className="text-xs text-red-500 hover:underline" onClick={() => setDeleting(report)}>
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Delete inspection report?"
        message={deleting ? `"${deleting.file_name}" will be permanently removed.` : ""}
        confirmLabel="Delete"
        danger
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          const res = await deleteInspectionReport(projectId, deleting.id);
          if (!res.ok) {
            notify("error", res.error ?? "Could not delete report.");
          } else {
            onRemove(deleting.id);
          }
          setDeleting(null);
        }}
      />
    </div>
  );
}

function WarrantyItem({
  projectId,
  item,
  reports,
  canManage,
  onUpdate,
  onRemove,
  onDetachReport,
}: {
  projectId: string;
  item: WarrantyItemRow;
  reports: InspectionReportRow[];
  canManage: boolean;
  onUpdate: (id: string, patch: Partial<WarrantyItemRow>) => void;
  onRemove: (id: string) => void;
  onDetachReport: (reportId: string) => void;
}) {
  const { notify } = useToast();
  const { run, isRunning } = useBackgroundTasks();
  const uploadTaskKey = `warranty-photo:${item.id}`;
  const [expanded, setExpanded] = useState(false);
  const [comment, setComment] = useState(item.comment ?? "");
  const [savingComment, setSavingComment] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function handleToggle(done: boolean) {
    onUpdate(item.id, { done });
    const res = await toggleWarrantyItem(projectId, item.id, done, item.title);
    if (!res.ok) {
      notify("error", res.error ?? "Could not update item.");
      onUpdate(item.id, { done: !done });
    }
  }

  async function handleStatusChange(status: WarrantyItemStatus) {
    const previous = item.status;
    onUpdate(item.id, { status });
    const res = await setWarrantyStatus(projectId, item.id, status, item.title);
    if (!res.ok) {
      notify("error", res.error ?? "Could not update status.");
      onUpdate(item.id, { status: previous });
      return;
    }
    // Not covered by warranty means it was never going to be fixed under
    // this claim — clear a stray "Fixed" check rather than leaving it
    // checked-but-disabled.
    if (status === "invalidated" && item.done) {
      handleToggle(false);
    }
  }

  async function handleSaveComment() {
    setSavingComment(true);
    const res = await updateWarrantyComment(projectId, item.id, comment);
    if (!res.ok) {
      notify("error", res.error ?? "Could not save note.");
    } else {
      onUpdate(item.id, { comment: comment || null });
    }
    setSavingComment(false);
  }

  async function handlePhotoUpload(file: File) {
    setUploading(true);
    try {
      await run(uploadTaskKey, `Uploading photo for "${item.title}"…`, async () => {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error("Not signed in.");

        const path = `${user.id}/${projectId}/${item.id}-${Date.now()}-${file.name}`;
        const { error: uploadError } = await supabase.storage.from("checklist-photos").upload(path, file, {
          contentType: file.type,
        });
        if (uploadError) throw new Error(uploadError.message);

        const { data: pub } = supabase.storage.from("checklist-photos").getPublicUrl(path);
        const res = await addWarrantyPhoto(projectId, item.id, pub.publicUrl, item.title);
        if (!res.ok) throw new Error(res.error ?? "Could not save photo.");

        onUpdate(item.id, {
          checklist_photos: [...item.checklist_photos, { id: crypto.randomUUID(), storage_url: pub.publicUrl }],
        });
        notify("success", "Photo added.");
      });
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Photo upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function handleDeletePhoto(photoId: string) {
    const res = await deleteWarrantyPhoto(projectId, photoId);
    if (!res.ok) {
      notify("error", res.error ?? "Could not remove photo.");
    } else {
      onUpdate(item.id, { checklist_photos: item.checklist_photos.filter((p) => p.id !== photoId) });
    }
  }

  return (
    <div className="rounded-lg border border-blueprint/10">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <input
          type="checkbox"
          checked={item.done}
          onChange={(e) => handleToggle(e.target.checked)}
          title="Fixed"
          disabled={!canManage || item.status === "invalidated"}
        />
        <button
          className={`flex-1 text-left text-sm ${
            item.status === "invalidated"
              ? "text-red-400 line-through"
              : item.done
                ? "text-blueprint/40 line-through"
                : "text-blueprint-dark"
          }`}
          onClick={() => setExpanded((e) => !e)}
        >
          {item.title}
        </button>
        {canManage ? (
          <select
            className={`input w-auto shrink-0 text-xs ${
              item.status === "validated" ? "text-sage-dark" : item.status === "invalidated" ? "text-red-600" : "text-blueprint/50"
            }`}
            value={item.status}
            onChange={(e) => handleStatusChange(e.target.value as WarrantyItemStatus)}
          >
            <option value="pending">Pending review</option>
            <option value="validated">Validate</option>
            <option value="invalidated">Not covered by warranty</option>
          </select>
        ) : (
          <span
            className={`shrink-0 text-xs ${
              item.status === "validated" ? "text-sage-dark" : item.status === "invalidated" ? "text-red-600" : "text-blueprint/50"
            }`}
          >
            {item.status === "validated" ? "Validated" : item.status === "invalidated" ? "Not covered" : "Pending review"}
          </span>
        )}
        <button
          className={`shrink-0 text-xs hover:underline ${
            item.comment || item.checklist_photos.length > 0 || reports.length > 0 ? "text-amber-dark" : "text-blueprint/40"
          }`}
          onClick={() => setExpanded((e) => !e)}
        >
          {item.comment && "📝 "}
          {item.checklist_photos.length > 0 && `📷${item.checklist_photos.length} `}
          {reports.length > 0 && `📄${reports.length} `}
          {expanded ? "Details ▾" : "Details ▸"}
        </button>
        {canManage && (
          <button className="text-xs text-red-500 hover:underline" onClick={() => setConfirmDelete(true)}>
            Remove
          </button>
        )}
      </div>

      {expanded && (
        <div className="space-y-2 border-t border-blueprint/10 p-3">
          <textarea
            className="input"
            rows={2}
            placeholder="Notes…"
            value={comment}
            readOnly={!canManage}
            onChange={(e) => setComment(e.target.value)}
            onBlur={canManage ? handleSaveComment : undefined}
          />
          {savingComment && <p className="text-xs text-blueprint/40">Saving…</p>}

          {item.checklist_photos.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {item.checklist_photos.map((photo) => (
                <div key={photo.id} className="group relative h-16 w-16 overflow-hidden rounded-md">
                  <Image src={photo.storage_url} alt="" fill className="object-cover" unoptimized />
                  {canManage && (
                    <button
                      className="absolute inset-0 hidden items-center justify-center bg-blueprint-dark/60 text-xs text-white group-hover:flex"
                      onClick={() => handleDeletePhoto(photo.id)}
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {canManage && (
            <label className="btn-ghost inline-block cursor-pointer text-xs">
              {uploading || isRunning(uploadTaskKey) ? "Uploading…" : "+ Add photo"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handlePhotoUpload(file);
                }}
              />
            </label>
          )}

          {reports.length > 0 && (
            <div className="space-y-1 border-t border-blueprint/10 pt-2">
              <p className="text-xs font-medium text-blueprint/50">Inspection reports</p>
              {reports.map((report) => (
                <div key={report.id} className="flex items-center gap-2 text-xs">
                  <a
                    href={report.storage_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 truncate text-blueprint-dark hover:text-amber hover:underline"
                  >
                    📄 {report.file_name}
                  </a>
                  {canManage && (
                    <button className="text-blueprint/50 hover:underline" onClick={() => onDetachReport(report.id)}>
                      Detach
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {canManage && (
        <ConfirmDialog
          open={confirmDelete}
          title="Remove warranty item?"
          message={`"${item.title}" will be permanently removed.`}
          confirmLabel="Remove"
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            const res = await deleteWarrantyItem(projectId, item.id);
            if (!res.ok) {
              notify("error", res.error ?? "Could not remove item.");
            } else {
              onRemove(item.id);
            }
            setConfirmDelete(false);
          }}
        />
      )}
    </div>
  );
}
