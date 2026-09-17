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
  addWarrantyRequestComment,
  approveWarrantyItemRequest,
  assignWarrantyRequestSubcontractor,
  attachInspectionReport,
  deleteInspectionReport,
  deleteWarrantyItem,
  deleteWarrantyPhoto,
  deleteWarrantyRequestComment,
  rejectWarrantyItemRequest,
  setWarrantyRequestProgress,
  setWarrantyStatus,
  toggleWarrantyItem,
  updateWarrantyComment,
  type CreatedWarrantyItem,
} from "@/app/projects/[id]/warranty-request/actions";
import type { UserRole, WarrantyItemRequest, WarrantyItemRequestComment, WarrantyItemStatus, WarrantyRequestProgress } from "@/lib/types";
import { SIGNED_URL_TTL_SECONDS } from "@/lib/storageClient";

const PROGRESS_LABELS: Record<WarrantyRequestProgress, string> = {
  open: "Open",
  in_progress: "Working on it",
  complete: "Complete",
};

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

export interface InspectionReportRow {
  id: string;
  project_id: string;
  checklist_item_id: string | null;
  warranty_item_request_id: string | null;
  file_name: string;
  storage_url: string;
  created_at: string;
}

export interface SubcontractorOption {
  id: string;
  company_name: string;
  trade: string | null;
}

export function WarrantyRequestClient({
  projectId,
  initialItems,
  initialReports,
  initialRequests,
  initialComments,
  subcontractors,
  viewerRole,
  currentUserId,
}: {
  projectId: string;
  initialItems: WarrantyItemRow[];
  initialReports: InspectionReportRow[];
  initialRequests: WarrantyItemRequest[];
  initialComments: WarrantyItemRequestComment[];
  subcontractors: SubcontractorOption[];
  viewerRole: UserRole;
  currentUserId: string | null;
}) {
  const { notify } = useToast();
  const [items, setItems] = useState<WarrantyItemRow[]>(initialItems);
  const [reports, setReports] = useState<InspectionReportRow[]>(initialReports);
  const [requests, setRequests] = useState<WarrantyItemRequest[]>(initialRequests);
  const [comments, setComments] = useState<WarrantyItemRequestComment[]>(initialComments);
  const [newTitle, setNewTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const fixed = items.filter((i) => i.done).length;
  // The 'warranty' role can watch checklist items, notes, and photos here
  // and chat about them, but can't mutate anything directly — they file a
  // request instead, which a Contractor or Developer approves or rejects.
  const canManage = viewerRole !== "warranty";
  // Contractor/Developer/PM manage a request end to end: approve/reject it,
  // move its progress, assign a subcontractor, and comment on it — the
  // 'warranty' role who filed it (and, for now, Owner) only ever watches.
  const canManageRequests = viewerRole === "contractor" || viewerRole === "developer" || viewerRole === "pm";

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

  async function handleSetProgress(request: WarrantyItemRequest, progress: WarrantyRequestProgress) {
    const previous = request.progress;
    setRequests((prev) => prev.map((r) => (r.id === request.id ? { ...r, progress } : r)));
    const res = await setWarrantyRequestProgress(projectId, request.id, progress, request.title);
    if (!res.ok) {
      notify("error", res.error ?? "Could not update status.");
      setRequests((prev) => prev.map((r) => (r.id === request.id ? { ...r, progress: previous } : r)));
    }
  }

  async function handleAssignSubcontractor(request: WarrantyItemRequest, subcontractorId: string | null) {
    const previous = request.subcontractor_id;
    setRequests((prev) => prev.map((r) => (r.id === request.id ? { ...r, subcontractor_id: subcontractorId } : r)));
    const res = await assignWarrantyRequestSubcontractor(projectId, request.id, subcontractorId);
    if (!res.ok) {
      notify("error", res.error ?? "Could not assign a subcontractor.");
      setRequests((prev) => prev.map((r) => (r.id === request.id ? { ...r, subcontractor_id: previous } : r)));
    }
  }

  async function handleAddComment(requestId: string, body: string) {
    const res = await addWarrantyRequestComment(projectId, requestId, body);
    if (!res.ok || !res.id) {
      notify("error", res.error ?? "Could not add comment.");
      return;
    }
    setComments((prev) => [
      ...prev,
      {
        id: res.id!,
        request_id: requestId,
        user_id: currentUserId ?? "",
        sender_email: "you",
        body: body.trim(),
        created_at: res.createdAt ?? new Date().toISOString(),
      },
    ]);
  }

  async function handleDeleteComment(commentId: string) {
    const previous = comments;
    setComments((prev) => prev.filter((c) => c.id !== commentId));
    const res = await deleteWarrantyRequestComment(projectId, commentId);
    if (!res.ok) {
      notify("error", res.error ?? "Could not delete comment.");
      setComments(previous);
    }
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

      <RequestsSection
        projectId={projectId}
        requests={requests}
        comments={comments}
        reports={reports}
        subcontractors={subcontractors}
        canManageRequests={canManageRequests}
        currentUserId={currentUserId}
        onApprove={handleApprove}
        onReject={handleReject}
        onSetProgress={handleSetProgress}
        onAssignSubcontractor={handleAssignSubcontractor}
        onAddComment={handleAddComment}
        onDeleteComment={handleDeleteComment}
        onReportAdd={(r) => setReports((prev) => [r, ...prev])}
      />
    </div>
  );
}

// Only ever rendered for Contractor/Developer/PM/Owner now — the
// 'warranty' role gets CreateWarrantyRequestForm instead (page.tsx
// branches before this component is even reached), so there's no
// "submit a request from here" path to render for it anymore.
function RequestsSection({
  projectId,
  requests,
  comments,
  reports,
  subcontractors,
  canManageRequests,
  currentUserId,
  onApprove,
  onReject,
  onSetProgress,
  onAssignSubcontractor,
  onAddComment,
  onDeleteComment,
  onReportAdd,
}: {
  projectId: string;
  requests: WarrantyItemRequest[];
  comments: WarrantyItemRequestComment[];
  reports: InspectionReportRow[];
  subcontractors: SubcontractorOption[];
  canManageRequests: boolean;
  currentUserId: string | null;
  onApprove: (request: WarrantyItemRequest) => Promise<void>;
  onReject: (request: WarrantyItemRequest) => Promise<void>;
  onSetProgress: (request: WarrantyItemRequest, progress: WarrantyRequestProgress) => Promise<void>;
  onAssignSubcontractor: (request: WarrantyItemRequest, subcontractorId: string | null) => Promise<void>;
  onAddComment: (requestId: string, body: string) => Promise<void>;
  onDeleteComment: (commentId: string) => Promise<void>;
  onReportAdd: (report: InspectionReportRow) => void;
}) {
  const [filterCategory, setFilterCategory] = useState<"all" | string>("all");
  const usedCategories = Array.from(new Set(requests.map((r) => r.category).filter((c): c is string => !!c))).sort();
  const filteredRequests = filterCategory === "all" ? requests : requests.filter((r) => r.category === filterCategory);

  if (requests.length === 0) return null;

  return (
    <div className="card p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-blueprint-dark">Warranty Item Requests</h2>
        {usedCategories.length > 0 && (
          <select className="input w-auto py-1 text-xs" value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
            <option value="all">All categories</option>
            {usedCategories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
      </div>
      <p className="mb-4 text-sm text-blueprint/60">
        {canManageRequests
          ? "Requests filed by a warranty account — approve or reject each one, track it through to done, assign a subcontractor, and leave notes for the record."
          : "Items requested but not yet added to the warranty list above."}
      </p>

      {filteredRequests.length === 0 ? (
        <p className="text-sm text-blueprint/40">No requests in this category.</p>
      ) : (
        <div className="space-y-3">
          {filteredRequests.map((request) => (
            <WarrantyRequestCard
              key={request.id}
              projectId={projectId}
              request={request}
              comments={comments.filter((c) => c.request_id === request.id)}
              reports={reports.filter((r) => r.warranty_item_request_id === request.id)}
              subcontractors={subcontractors}
              canManageRequests={canManageRequests}
              currentUserId={currentUserId}
              onApprove={onApprove}
              onReject={onReject}
              onSetProgress={onSetProgress}
              onAssignSubcontractor={onAssignSubcontractor}
              onAddComment={onAddComment}
              onDeleteComment={onDeleteComment}
              onReportAdd={onReportAdd}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const STATUS_BADGE: Record<WarrantyItemRequest["status"], string> = {
  pending: "badge-amber",
  approved: "badge-sage",
  rejected: "badge bg-red-100 text-red-700",
};

const PROGRESS_BADGE: Record<WarrantyRequestProgress, string> = {
  open: "badge bg-blueprint/10 text-blueprint",
  in_progress: "badge-amber",
  complete: "badge-sage",
};

export function WarrantyRequestCard({
  projectId,
  request,
  comments,
  reports,
  subcontractors,
  canManageRequests,
  currentUserId,
  onApprove,
  onReject,
  onSetProgress,
  onAssignSubcontractor,
  onAddComment,
  onDeleteComment,
  onReportAdd,
}: {
  projectId: string;
  request: WarrantyItemRequest;
  comments: WarrantyItemRequestComment[];
  reports: InspectionReportRow[];
  subcontractors: SubcontractorOption[];
  canManageRequests: boolean;
  currentUserId: string | null;
  onApprove: (request: WarrantyItemRequest) => Promise<void>;
  onReject: (request: WarrantyItemRequest) => Promise<void>;
  onSetProgress: (request: WarrantyItemRequest, progress: WarrantyRequestProgress) => Promise<void>;
  onAssignSubcontractor: (request: WarrantyItemRequest, subcontractorId: string | null) => Promise<void>;
  onAddComment: (requestId: string, body: string) => Promise<void>;
  onDeleteComment: (commentId: string) => Promise<void>;
  onReportAdd: (report: InspectionReportRow) => void;
}) {
  const { notify } = useToast();
  const [acting, setActing] = useState(false);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const assignedSub = subcontractors.find((s) => s.id === request.subcontractor_id);

  async function handleUploadReport(file: File) {
    setUploading(true);
    try {
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

      const { data: pub, error: signError } = await supabase.storage
        .from("project-files")
        .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
      if (signError || !pub) throw new Error(signError?.message ?? "Could not get a URL for the uploaded file.");

      const res = await addInspectionReport(projectId, file.name, pub.signedUrl, request.id);
      if (!res.ok || !res.id) throw new Error(res.error ?? "Could not save report.");

      onReportAdd({
        id: res.id,
        project_id: projectId,
        checklist_item_id: null,
        warranty_item_request_id: request.id,
        file_name: file.name,
        storage_url: pub.signedUrl,
        created_at: new Date().toISOString(),
      });
      notify("success", `Uploaded "${file.name}".`);
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function handlePostComment() {
    if (!draft.trim()) return;
    setPosting(true);
    await onAddComment(request.id, draft);
    setDraft("");
    setPosting(false);
  }

  return (
    <div className="rounded-lg border border-blueprint/10 p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="font-medium text-blueprint-dark">{request.title}</p>
            {request.category && <span className="badge bg-blueprint/10 text-blueprint">{request.category}</span>}
          </div>
          {request.comment && <p className="mt-0.5 text-xs text-blueprint/60">{request.comment}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <span className={`${STATUS_BADGE[request.status]} text-xs`}>{request.status}</span>
          <span className={`${PROGRESS_BADGE[request.progress]} text-xs`}>{PROGRESS_LABELS[request.progress]}</span>
        </div>
      </div>

      {request.status === "pending" && canManageRequests && (
        <div className="mt-2 flex gap-3">
          <button
            className="text-xs text-sage-dark hover:underline"
            disabled={acting}
            onClick={async () => {
              setActing(true);
              await onApprove(request);
              setActing(false);
            }}
          >
            Approve
          </button>
          <button
            className="text-xs text-red-500 hover:underline"
            disabled={acting}
            onClick={async () => {
              setActing(true);
              await onReject(request);
              setActing(false);
            }}
          >
            Reject
          </button>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-blueprint/10 pt-2.5">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-blueprint/50">Status:</span>
          {canManageRequests ? (
            <select
              className="input w-auto py-1 text-xs"
              value={request.progress}
              onChange={(e) => onSetProgress(request, e.target.value as WarrantyRequestProgress)}
            >
              {(Object.keys(PROGRESS_LABELS) as WarrantyRequestProgress[]).map((p) => (
                <option key={p} value={p}>
                  {PROGRESS_LABELS[p]}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-xs text-blueprint-dark">{PROGRESS_LABELS[request.progress]}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-blueprint/50">Subcontractor:</span>
          {canManageRequests ? (
            <select
              className="input w-auto py-1 text-xs"
              value={request.subcontractor_id ?? ""}
              onChange={(e) => onAssignSubcontractor(request, e.target.value || null)}
            >
              <option value="">Unassigned</option>
              {subcontractors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.company_name}
                  {s.trade ? ` — ${s.trade}` : ""}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-xs text-blueprint-dark">
              {assignedSub ? assignedSub.company_name : "Unassigned"}
            </span>
          )}
        </div>
      </div>

      <div className="mt-2.5 border-t border-blueprint/10 pt-2.5">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-medium text-blueprint/50">Inspection reports</span>
          <label className="btn-ghost cursor-pointer px-2 py-0.5 text-xs">
            {uploading ? "Uploading…" : "+ Attach report"}
            <input
              type="file"
              accept="application/pdf,image/*,.doc,.docx"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleUploadReport(file);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {reports.length === 0 ? (
          <p className="text-xs text-blueprint/40">None attached yet.</p>
        ) : (
          <div className="space-y-1">
            {reports.map((r) => (
              <a
                key={r.id}
                href={r.storage_url}
                target="_blank"
                rel="noopener noreferrer"
                className="block truncate text-xs text-blueprint-dark hover:text-amber hover:underline"
              >
                📄 {r.file_name}
              </a>
            ))}
          </div>
        )}
      </div>

      <div className="mt-2.5 border-t border-blueprint/10 pt-2.5">
        <span className="mb-1.5 block text-xs font-medium text-blueprint/50">Comments &amp; notes</span>
        {comments.length === 0 ? (
          <p className="text-xs text-blueprint/40">No comments yet.</p>
        ) : (
          <div className="mb-2 space-y-1.5">
            {comments.map((c) => (
              <div key={c.id} className="group rounded bg-concrete px-2 py-1.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-blueprint-dark">{c.sender_email}</span>
                  <span className="flex items-center gap-2 text-blueprint/40">
                    {new Date(c.created_at).toLocaleDateString([], { month: "short", day: "numeric" })}
                    {c.user_id === currentUserId && (
                      <button
                        className="opacity-0 hover:underline group-hover:opacity-100"
                        onClick={() => onDeleteComment(c.id)}
                      >
                        Delete
                      </button>
                    )}
                  </span>
                </div>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-blueprint-dark">{c.body}</p>
              </div>
            ))}
          </div>
        )}
        {canManageRequests && (
          <div className="flex gap-2">
            <input
              className="input flex-1 py-1 text-xs"
              placeholder="Add a comment or note…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handlePostComment()}
            />
            <button className="btn-outline px-2 py-1 text-xs" onClick={handlePostComment} disabled={posting || !draft.trim()}>
              Post
            </button>
          </div>
        )}
      </div>
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

        const { data: pub, error: pubSignError } = await supabase.storage
          .from("project-files")
          .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
        if (pubSignError || !pub) throw new Error(pubSignError?.message ?? "Could not get a URL for the uploaded file.");
        const res = await addInspectionReport(projectId, file.name, pub.signedUrl);
        if (!res.ok || !res.id) throw new Error(res.error ?? "Could not save report.");

        onAdd({
          id: res.id,
          project_id: projectId,
          checklist_item_id: null,
          warranty_item_request_id: null,
          file_name: file.name,
          storage_url: pub.signedUrl,
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
              const { data: imgPub, error: imgPubSignError } = await supabase.storage
                .from("project-files")
                .createSignedUrl(imgPath, SIGNED_URL_TTL_SECONDS);
              if (imgPubSignError || !imgPub) throw new Error(imgPubSignError?.message ?? "Could not get a URL for the uploaded file.");
              pageImageUrls.push(imgPub.signedUrl);
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

        const { data: pub, error: pubSignError } = await supabase.storage
          .from("checklist-photos")
          .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
        if (pubSignError || !pub) throw new Error(pubSignError?.message ?? "Could not get a URL for the uploaded file.");
        const res = await addWarrantyPhoto(projectId, item.id, pub.signedUrl, item.title);
        if (!res.ok) throw new Error(res.error ?? "Could not save photo.");

        onUpdate(item.id, {
          checklist_photos: [...item.checklist_photos, { id: crypto.randomUUID(), storage_url: pub.signedUrl }],
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
            const res = await deleteWarrantyItem(projectId, item.id, item.title);
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
