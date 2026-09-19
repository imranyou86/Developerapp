"use client";

import { useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/Toast";
import { useBackgroundTasks } from "@/components/BackgroundTasks";
import { fetchWithRetry } from "@/lib/fetchWithRetry";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Modal } from "@/components/Modal";
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
  deleteWarrantyItemRequest,
  deleteWarrantyItems,
  deleteWarrantyPhoto,
  deleteWarrantyRequestComment,
  rejectWarrantyItemRequest,
  requestWarrantyItems,
  setWarrantyRequestProgress,
  setWarrantyRequestSchedule,
  setWarrantyStatus,
  toggleWarrantyItem,
  toggleWarrantyItems,
  updateWarrantyComment,
  updateWarrantyRequestCategory,
  type CreatedWarrantyItem,
} from "@/app/projects/[id]/warranty-request/actions";
import { usePersistedSelection } from "@/lib/usePersistedSelection";
import type { UserRole, WarrantyItemRequest, WarrantyItemRequestComment, WarrantyItemStatus, WarrantyRequestProgress } from "@/lib/types";
import { SIGNED_URL_TTL_SECONDS } from "@/lib/storageClient";
import { telHref } from "@/lib/phone";
import { formatTimeWindow } from "@/lib/timeFormat";
import { extractFindingsFromReport } from "@/lib/inspectionReportExtraction";
import { WARRANTY_REQUEST_CATEGORIES } from "@/lib/warrantyRequestCategories";

const PROGRESS_LABELS: Record<WarrantyRequestProgress, string> = {
  open: "Open",
  in_progress: "Working on it",
  complete: "Complete",
};

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
  contact_name: string | null;
  trade: string | null;
  phone: string | null;
  email: string | null;
}

export interface WarrantyMemberOption {
  id: string;
  email: string;
  displayName: string | null;
}

function groupRequestsByCategory(requests: WarrantyItemRequest[]): { label: string; items: WarrantyItemRequest[] }[] {
  const byCategory = new Map<string, WarrantyItemRequest[]>();
  for (const r of requests) {
    const key = r.category ?? "Uncategorized";
    const list = byCategory.get(key) ?? [];
    list.push(r);
    byCategory.set(key, list);
  }
  const orderedLabels = [...WARRANTY_REQUEST_CATEGORIES, "Uncategorized"];
  return orderedLabels
    .filter((label) => byCategory.has(label))
    .map((label) => ({ label, items: byCategory.get(label)! }));
}

function GroupStatusSummary({ items }: { items: WarrantyItemRequest[] }) {
  const pending = items.filter((i) => i.status === "pending").length;
  const approved = items.filter((i) => i.status === "approved").length;
  const rejected = items.filter((i) => i.status === "rejected").length;
  const parts = [
    pending > 0 && `${pending} pending`,
    approved > 0 && `${approved} approved`,
    rejected > 0 && `${rejected} rejected`,
  ].filter((p): p is string => !!p);
  return <span className="text-xs text-blueprint/50">{parts.join(" · ")}</span>;
}

function formatScheduledVisit(date: string | null, start: string | null, end: string | null): string | null {
  if (!date) return null;
  const [y, m, d] = date.split("-").map(Number);
  const dateLabel = new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const windowLabel = formatTimeWindow(start, end);
  return windowLabel ? `${dateLabel}, ${windowLabel}` : dateLabel;
}

export function WarrantyRequestClient({
  projectId,
  initialItems,
  initialReports,
  initialRequests,
  initialComments,
  subcontractors,
  warrantyMembers,
  viewerRole,
  currentUserId,
}: {
  projectId: string;
  initialItems: WarrantyItemRow[];
  initialReports: InspectionReportRow[];
  initialRequests: WarrantyItemRequest[];
  initialComments: WarrantyItemRequestComment[];
  subcontractors: SubcontractorOption[];
  warrantyMembers: WarrantyMemberOption[];
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
  const [fileOnBehalfOpen, setFileOnBehalfOpen] = useState(false);
  const [jobReportOpen, setJobReportOpen] = useState(false);
  const fixed = items.filter((i) => i.done).length;
  // The 'warranty' role can watch checklist items, notes, and photos here
  // and chat about them, but can't mutate anything directly — they file a
  // request instead, which a Contractor or Developer approves or rejects.
  const canManage = viewerRole !== "warranty";
  // Contractor/Developer/PM manage a request end to end: approve/reject it,
  // move its progress, assign a subcontractor, and comment on it — the
  // 'warranty' role who filed it (and, for now, Owner) only ever watches.
  const canManageRequests = viewerRole === "contractor" || viewerRole === "developer" || viewerRole === "pm";
  // Only Contractor/Developer can delete a request outright (not PM) — see
  // requireCanDeleteRequest in actions.ts and warranty_item_requests_delete
  // in migration 049.
  const canDeleteRequests = viewerRole === "contractor" || viewerRole === "developer";

  const [selectedItems, setSelectedItems] = usePersistedSelection(`warranty-items-selected:${projectId}`, () => new Set());
  const [selectModeItems, setSelectModeItems] = useState(false);
  const [confirmBulkDeleteItems, setConfirmBulkDeleteItems] = useState(false);
  const [bulkItemsBusy, setBulkItemsBusy] = useState(false);
  const allItemsSelected = items.length > 0 && items.every((i) => selectedItems.has(i.id));

  function updateItem(id: string, patch: Partial<WarrantyItemRow>) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }

  function toggleSelectItem(id: string) {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllItems(check: boolean) {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      items.forEach((i) => (check ? next.add(i.id) : next.delete(i.id)));
      return next;
    });
  }

  async function handleBulkToggleItems(markDone: boolean) {
    const ids = items.filter((i) => selectedItems.has(i.id)).map((i) => i.id);
    if (ids.length === 0) return;
    setBulkItemsBusy(true);
    ids.forEach((id) => updateItem(id, { done: markDone }));
    const res = await toggleWarrantyItems(projectId, ids, markDone);
    setBulkItemsBusy(false);
    if (!res.ok) {
      notify("error", res.error ?? "Could not update items.");
      ids.forEach((id) => updateItem(id, { done: !markDone }));
      return;
    }
    notify("success", `${ids.length} item${ids.length === 1 ? "" : "s"} marked ${markDone ? "fixed" : "not fixed"}.`);
  }

  async function handleBulkDeleteItems() {
    const ids = items.filter((i) => selectedItems.has(i.id)).map((i) => i.id);
    if (ids.length === 0) return;
    setBulkItemsBusy(true);
    const res = await deleteWarrantyItems(projectId, ids);
    setBulkItemsBusy(false);
    setConfirmBulkDeleteItems(false);
    if (!res.ok) {
      notify("error", res.error ?? "Could not delete items.");
      return;
    }
    const deletedIds = res.deletedIds ?? ids;
    removeItems(deletedIds);
    setSelectedItems((prev) => {
      const next = new Set(prev);
      deletedIds.forEach((id) => next.delete(id));
      return next;
    });
    notify("success", `${deletedIds.length} item${deletedIds.length === 1 ? "" : "s"} deleted.`);
  }
  function removeItems(ids: string[]) {
    const removed = new Set(ids);
    setItems((prev) => prev.filter((i) => !removed.has(i.id)));
    // Mirrors the DB's "on delete set null" on inspection_reports.checklist_item_id —
    // a report attached to a deleted item goes back to unattached, not orphaned.
    setReports((prev) => prev.map((r) => (r.checklist_item_id && removed.has(r.checklist_item_id) ? { ...r, checklist_item_id: null } : r)));
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

  async function handleReject(request: WarrantyItemRequest, note?: string) {
    const res = await rejectWarrantyItemRequest(projectId, request.id, note);
    if (!res.ok) {
      notify("error", res.error ?? "Could not reject request.");
      return;
    }
    setRequests((prev) =>
      prev.map((r) => (r.id === request.id ? { ...r, status: "rejected", rejection_note: note?.trim() || null } : r))
    );
  }

  async function handleUpdateCategory(request: WarrantyItemRequest, category: string | null) {
    const previous = request.category;
    setRequests((prev) => prev.map((r) => (r.id === request.id ? { ...r, category } : r)));
    const res = await updateWarrantyRequestCategory(projectId, request.id, category);
    if (!res.ok) {
      notify("error", res.error ?? "Could not update the category.");
      setRequests((prev) => prev.map((r) => (r.id === request.id ? { ...r, category: previous } : r)));
    }
  }

  async function handleDeleteRequest(request: WarrantyItemRequest) {
    const res = await deleteWarrantyItemRequest(projectId, request.id);
    if (!res.ok) {
      notify("error", res.error ?? "Could not delete request.");
      return;
    }
    // group_id ... on delete cascade already removed any child tasks in the
    // DB when deleting a group — mirror that here so local state matches.
    const removedIds = new Set([request.id, ...requests.filter((r) => r.group_id === request.id).map((r) => r.id)]);
    setRequests((prev) => prev.filter((r) => !removedIds.has(r.id)));
    setComments((prev) => prev.filter((c) => !removedIds.has(c.request_id)));
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

  async function handleSetSchedule(
    request: WarrantyItemRequest,
    schedule: { date: string | null; timeStart: string | null; timeEnd: string | null }
  ) {
    const previous = {
      scheduled_date: request.scheduled_date,
      scheduled_time_start: request.scheduled_time_start,
      scheduled_time_end: request.scheduled_time_end,
    };
    setRequests((prev) =>
      prev.map((r) =>
        r.id === request.id
          ? { ...r, scheduled_date: schedule.date, scheduled_time_start: schedule.timeStart, scheduled_time_end: schedule.timeEnd }
          : r
      )
    );
    const res = await setWarrantyRequestSchedule(projectId, request.id, schedule, request.title);
    if (!res.ok) {
      notify("error", res.error ?? "Could not save the visit schedule.");
      setRequests((prev) => (prev.map((r) => (r.id === request.id ? { ...r, ...previous } : r))));
    } else {
      notify("success", schedule.date ? "Visit scheduled." : "Visit schedule cleared.");
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
        sender_name: "you",
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

        {canManage && items.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-b border-blueprint/10 pb-2 text-xs">
            {!selectModeItems ? (
              <button className="text-blueprint/60 hover:underline" onClick={() => setSelectModeItems(true)}>
                Select
              </button>
            ) : (
              <>
                <label className="flex items-center gap-1.5 text-blueprint/60">
                  <input type="checkbox" checked={allItemsSelected} onChange={(e) => selectAllItems(e.target.checked)} />
                  {selectedItems.size > 0 ? `${selectedItems.size} selected` : "Select all"}
                </label>
                {selectedItems.size > 0 && (
                  <>
                    <button className="text-blueprint/60 hover:underline" onClick={() => handleBulkToggleItems(true)} disabled={bulkItemsBusy}>
                      Mark fixed
                    </button>
                    <button className="text-blueprint/60 hover:underline" onClick={() => handleBulkToggleItems(false)} disabled={bulkItemsBusy}>
                      Mark not fixed
                    </button>
                    <button
                      className="text-red-500 hover:underline"
                      onClick={() => setConfirmBulkDeleteItems(true)}
                      disabled={bulkItemsBusy}
                    >
                      Delete selected
                    </button>
                  </>
                )}
                <button
                  className="text-blueprint/40 hover:underline"
                  onClick={() => {
                    selectAllItems(false);
                    setSelectModeItems(false);
                  }}
                  disabled={bulkItemsBusy}
                >
                  Done
                </button>
              </>
            )}
          </div>
        )}

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
                onRemove={(id) => removeItems([id])}
                onDetachReport={(reportId) => handleAttach(reportId, null)}
                selectMode={selectModeItems}
                selected={selectedItems.has(item.id)}
                onToggleSelect={() => toggleSelectItem(item.id)}
              />
            </div>
          ))}
        </div>

        <ConfirmDialog
          open={confirmBulkDeleteItems}
          title="Delete selected items?"
          message={`${selectedItems.size} warranty item${selectedItems.size === 1 ? "" : "s"} will be permanently removed.`}
          confirmLabel="Delete"
          danger
          busy={bulkItemsBusy}
          onCancel={() => setConfirmBulkDeleteItems(false)}
          onConfirm={handleBulkDeleteItems}
        />

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
        canDeleteRequests={canDeleteRequests}
        currentUserId={currentUserId}
        onApprove={handleApprove}
        onReject={handleReject}
        onDelete={handleDeleteRequest}
        onSetProgress={handleSetProgress}
        onAssignSubcontractor={handleAssignSubcontractor}
        onSetSchedule={handleSetSchedule}
        onUpdateCategory={handleUpdateCategory}
        onAddComment={handleAddComment}
        onDeleteComment={handleDeleteComment}
        onReportAdd={(r) => setReports((prev) => [r, ...prev])}
        onFileOnBehalf={() => setFileOnBehalfOpen(true)}
        onGenerateJobReport={() => setJobReportOpen(true)}
      />

      {canManageRequests && (
        <>
          <FileOnBehalfModal
            open={fileOnBehalfOpen}
            projectId={projectId}
            warrantyMembers={warrantyMembers}
            onClose={() => setFileOnBehalfOpen(false)}
            onSubmitted={(newRequests) => setRequests((prev) => [...newRequests, ...prev])}
          />
          <JobReportModal projectId={projectId} subcontractors={subcontractors} open={jobReportOpen} onClose={() => setJobReportOpen(false)} />
        </>
      )}
    </div>
  );
}

// Lets a Contractor/Developer/PM file a request as if a specific homeowner
// had submitted it themselves — for an account that doesn't know how to use
// the form, or would rather call it in. requested_by is set to that
// homeowner's own id (requestWarrantyItems' onBehalfOfUserId), so it shows
// up in their own "Your Warranty Requests" view exactly like a
// self-filed one, with the same approve/reject workflow.
function FileOnBehalfModal({
  open,
  projectId,
  warrantyMembers,
  onClose,
  onSubmitted,
}: {
  open: boolean;
  projectId: string;
  warrantyMembers: WarrantyMemberOption[];
  onClose: () => void;
  onSubmitted: (requests: WarrantyItemRequest[]) => void;
}) {
  const { notify } = useToast();
  const [onBehalfOf, setOnBehalfOf] = useState(warrantyMembers[0]?.id ?? "");
  const [category, setCategory] = useState("");
  const [tasks, setTasks] = useState<string[]>([""]);
  const [submitting, setSubmitting] = useState(false);

  function updateTask(i: number, value: string) {
    setTasks((prev) => prev.map((t, idx) => (idx === i ? value : t)));
  }
  function addTaskRow() {
    setTasks((prev) => [...prev, ""]);
  }
  function removeTaskRow(i: number) {
    setTasks((prev) => prev.filter((_, idx) => idx !== i));
  }
  function reset() {
    setTasks([""]);
    setCategory("");
  }

  async function handleSubmit() {
    const titles = tasks.map((t) => t.trim()).filter(Boolean);
    if (titles.length === 0 || !onBehalfOf) return;
    setSubmitting(true);
    const res = await requestWarrantyItems(
      projectId,
      titles.map((title) => ({ title, category: category || null })),
      onBehalfOf
    );
    setSubmitting(false);
    if (!res.ok || !res.ids) {
      notify("error", res.error ?? "Could not file the request.");
      return;
    }
    const ids = res.ids;
    const member = warrantyMembers.find((m) => m.id === onBehalfOf);
    const now = new Date().toISOString();
    // requestWarrantyItems buckets by category server-side — since this
    // form only ever submits one category for the whole batch, that's a
    // single bucket: one standalone request for a single task, or one group
    // row plus a child task row per title for two or more (see
    // requestWarrantyItems in actions.ts for the exact same logic this
    // mirrors).
    const base = {
      project_id: projectId,
      comment: null,
      category: category || null,
      requested_by: onBehalfOf,
      status: "pending" as const,
      progress: "open" as const,
      subcontractor_id: null,
      checklist_item_id: null,
      reviewed_by: null,
      reviewed_at: null,
      scheduled_date: null,
      scheduled_time_start: null,
      scheduled_time_end: null,
      rejection_note: null,
      created_at: now,
    };
    const newRequests: WarrantyItemRequest[] =
      titles.length === 1
        ? [{ ...base, id: ids[0], title: titles[0], is_group: false, group_id: null }]
        : [
            { ...base, id: ids[0], title: category || "Warranty items", is_group: true, group_id: null },
            ...titles.map((title, i) => ({ ...base, id: ids[i + 1], title, is_group: false, group_id: ids[0] })),
          ];
    onSubmitted(newRequests);
    notify(
      "success",
      `Filed ${titles.length} request${titles.length === 1 ? "" : "s"} for ${member?.displayName ?? member?.email ?? "that homeowner"}.`
    );
    reset();
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="File a request on behalf of a homeowner"
      footer={
        <>
          <button className="btn-outline" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={submitting || !onBehalfOf || tasks.every((t) => !t.trim())}
            onClick={handleSubmit}
          >
            {submitting ? "Filing…" : "File request"}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {warrantyMembers.length === 0 ? (
          <p className="text-sm text-blueprint/60">
            No warranty accounts are on this construction yet — invite one from the top of this page first.
          </p>
        ) : (
          <>
            <div>
              <label className="label">Homeowner</label>
              <select className="input" value={onBehalfOf} onChange={(e) => setOnBehalfOf(e.target.value)}>
                {warrantyMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName ?? m.email}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Category</label>
              <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">Uncategorized</option>
                {WARRANTY_REQUEST_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Tasks</label>
              <div className="space-y-2">
                {tasks.map((t, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      className="input flex-1"
                      placeholder="e.g. &quot;Leaky faucet in kitchen&quot;"
                      value={t}
                      onChange={(e) => updateTask(i, e.target.value)}
                      autoFocus={i === 0}
                    />
                    {tasks.length > 1 && (
                      <button type="button" className="text-xs text-red-500 hover:underline" onClick={() => removeTaskRow(i)}>
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button type="button" className="btn-ghost mt-2 text-xs" onClick={addTaskRow}>
                + Add another task
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// Lets a Contractor/Developer/PM download a PDF summary of everything
// currently assigned to one subcontractor on this construction — grouped by
// trade, with each task's status and any scheduled visit — to hand or email
// to that sub. Generated server-side (app/api/projects/[id]/subcontractor-job-report),
// same @react-pdf/renderer pattern as the House Book.
function JobReportModal({
  projectId,
  subcontractors,
  open,
  onClose,
}: {
  projectId: string;
  subcontractors: SubcontractorOption[];
  open: boolean;
  onClose: () => void;
}) {
  const { notify } = useToast();
  const { run, isRunning } = useBackgroundTasks();
  const taskKey = `subcontractor-job-report:${projectId}`;
  const [subcontractorId, setSubcontractorId] = useState(subcontractors[0]?.id ?? "");
  const [generating, setGenerating] = useState(false);

  async function handleGenerate() {
    if (!subcontractorId) return;
    const sub = subcontractors.find((s) => s.id === subcontractorId);
    setGenerating(true);
    try {
      await run(taskKey, "Putting together the job report…", async () => {
        const res = await fetchWithRetry(`/api/projects/${projectId}/subcontractor-job-report`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subcontractorId }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error ?? "Could not generate the job report.");
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${(sub?.company_name ?? "subcontractor").replace(/[^a-z0-9]+/gi, "-")}-job-report.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        notify("success", "Job report generated.");
      });
      onClose();
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Could not generate the job report.");
    } finally {
      setGenerating(false);
    }
  }

  const working = generating || isRunning(taskKey);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Generate a job report"
      footer={
        <>
          <button className="btn-outline" onClick={onClose} disabled={working}>
            Cancel
          </button>
          <button className="btn-primary" disabled={working || !subcontractorId} onClick={handleGenerate}>
            {working ? "Generating…" : "Download PDF"}
          </button>
        </>
      }
    >
      {subcontractors.length === 0 ? (
        <p className="text-sm text-blueprint/60">No subcontractors in the directory yet — add one from the Subcontractors tab first.</p>
      ) : (
        <div>
          <label className="label">Subcontractor</label>
          <select className="input" value={subcontractorId} onChange={(e) => setSubcontractorId(e.target.value)}>
            {subcontractors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.company_name}
                {s.trade ? ` — ${s.trade}` : ""}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-blueprint/50">
            Pulls in every warranty request or trade group currently assigned to this subcontractor on this construction — its status,
            scheduled visit, and task list — as a PDF you can send them.
          </p>
        </div>
      )}
    </Modal>
  );
}

export interface GroupedRequestCardsProps {
  projectId: string;
  requests: WarrantyItemRequest[];
  comments: WarrantyItemRequestComment[];
  reports: InspectionReportRow[];
  subcontractors: SubcontractorOption[];
  canManageRequests: boolean;
  canDeleteRequests: boolean;
  currentUserId: string | null;
  onApprove: (request: WarrantyItemRequest) => Promise<void>;
  onReject: (request: WarrantyItemRequest, note?: string) => Promise<void>;
  onDelete?: (request: WarrantyItemRequest) => Promise<void>;
  onSetProgress: (request: WarrantyItemRequest, progress: WarrantyRequestProgress) => Promise<void>;
  onAssignSubcontractor: (request: WarrantyItemRequest, subcontractorId: string | null) => Promise<void>;
  onSetSchedule: (
    request: WarrantyItemRequest,
    schedule: { date: string | null; timeStart: string | null; timeEnd: string | null }
  ) => Promise<void>;
  onUpdateCategory: (request: WarrantyItemRequest, category: string | null) => Promise<void>;
  onAddComment: (requestId: string, body: string) => Promise<void>;
  onDeleteComment: (commentId: string) => Promise<void>;
  onReportAdd: (report: InspectionReportRow) => void;
}

// Every request, organized into a section per trade (Electrical, Plumbing,
// …) instead of one long jumbled list — a group's heading and status
// summary stay put regardless of what happens to the individual tasks
// inside it, so at a glance you can see which tasks in, say, "Electrical"
// are approved/pending/rejected without them ever moving out of that
// section. Shared by the Contractor/Developer/PM dashboard
// (RequestsSection) and the homeowner's own view (MyWarrantyRequests) — the
// grouping and each card's controls (approve/reject/category/etc.) are
// identical, only which controls render differs, via canManageRequests.
export function GroupedRequestCards({
  projectId,
  requests,
  comments,
  reports,
  subcontractors,
  canManageRequests,
  canDeleteRequests,
  currentUserId,
  onApprove,
  onReject,
  onDelete,
  onSetProgress,
  onAssignSubcontractor,
  onSetSchedule,
  onUpdateCategory,
  onAddComment,
  onDeleteComment,
  onReportAdd,
}: GroupedRequestCardsProps) {
  // A task that belongs to a group (group_id set) is rendered nested inside
  // that group's own card below, not as its own sibling in the section list.
  const topLevel = requests.filter((r) => !r.group_id);
  const sections = groupRequestsByCategory(topLevel);

  return (
    <div className="space-y-5">
      {sections.map((section) => {
        // The real, individually-triaged tasks in this section — a
        // standalone request counts itself; a group contributes its child
        // tasks (never the group row itself, whose own status is unused).
        const flatTasks = section.items.flatMap((r) => (r.is_group ? requests.filter((t) => t.group_id === r.id) : [r]));
        return (
          <div key={section.label}>
            <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
              <h3 className="text-sm font-semibold text-blueprint-dark">{section.label}</h3>
              <GroupStatusSummary items={flatTasks} />
            </div>
            <div className="space-y-3">
              {section.items.map((request) =>
                request.is_group ? (
                  <WarrantyRequestGroupCard
                    key={request.id}
                    projectId={projectId}
                    group={request}
                    tasks={requests.filter((t) => t.group_id === request.id)}
                    comments={comments}
                    reports={reports}
                    subcontractors={subcontractors}
                    canManageRequests={canManageRequests}
                    canDeleteRequests={canDeleteRequests}
                    currentUserId={currentUserId}
                    onApprove={onApprove}
                    onReject={onReject}
                    onDelete={onDelete}
                    onSetProgress={onSetProgress}
                    onAssignSubcontractor={onAssignSubcontractor}
                    onSetSchedule={onSetSchedule}
                    onUpdateCategory={onUpdateCategory}
                    onAddComment={onAddComment}
                    onDeleteComment={onDeleteComment}
                    onReportAdd={onReportAdd}
                  />
                ) : (
                  <WarrantyRequestCard
                    key={request.id}
                    projectId={projectId}
                    request={request}
                    comments={comments.filter((c) => c.request_id === request.id)}
                    reports={reports.filter((r) => r.warranty_item_request_id === request.id)}
                    subcontractors={subcontractors}
                    canManageRequests={canManageRequests}
                    canDeleteRequests={canDeleteRequests}
                    currentUserId={currentUserId}
                    onApprove={onApprove}
                    onReject={onReject}
                    onDelete={onDelete}
                    onSetProgress={onSetProgress}
                    onAssignSubcontractor={onAssignSubcontractor}
                    onSetSchedule={onSetSchedule}
                    onUpdateCategory={onUpdateCategory}
                    onAddComment={onAddComment}
                    onDeleteComment={onDeleteComment}
                    onReportAdd={onReportAdd}
                  />
                )
              )}
            </div>
          </div>
        );
      })}
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
  canDeleteRequests,
  currentUserId,
  onApprove,
  onReject,
  onDelete,
  onSetProgress,
  onAssignSubcontractor,
  onSetSchedule,
  onUpdateCategory,
  onAddComment,
  onDeleteComment,
  onReportAdd,
  onFileOnBehalf,
  onGenerateJobReport,
}: GroupedRequestCardsProps & { onFileOnBehalf: () => void; onGenerateJobReport: () => void }) {
  if (requests.length === 0 && !canManageRequests) return null;

  return (
    <div className="card p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-blueprint-dark">Warranty Item Requests</h2>
        {canManageRequests && (
          <div className="flex flex-wrap gap-2">
            <button className="btn-outline text-xs" onClick={onGenerateJobReport}>
              Generate job report
            </button>
            <button className="btn-outline text-xs" onClick={onFileOnBehalf}>
              + File on behalf of a homeowner
            </button>
          </div>
        )}
      </div>
      <p className="mb-4 text-sm text-blueprint/60">
        {canManageRequests
          ? "Requests filed by a warranty account, organized by trade — approve or reject each task individually, track it through to done, assign a subcontractor, and leave notes for the record."
          : "Items requested but not yet added to the warranty list above."}
      </p>

      {requests.length === 0 ? (
        <p className="text-sm text-blueprint/40">No requests yet.</p>
      ) : (
        <GroupedRequestCards
          projectId={projectId}
          requests={requests}
          comments={comments}
          reports={reports}
          subcontractors={subcontractors}
          canManageRequests={canManageRequests}
          canDeleteRequests={canDeleteRequests}
          currentUserId={currentUserId}
          onApprove={onApprove}
          onReject={onReject}
          onDelete={onDelete}
          onSetProgress={onSetProgress}
          onAssignSubcontractor={onAssignSubcontractor}
          onSetSchedule={onSetSchedule}
          onUpdateCategory={onUpdateCategory}
          onAddComment={onAddComment}
          onDeleteComment={onDeleteComment}
          onReportAdd={onReportAdd}
        />
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

// A small reason prompt before rejecting — shared by a standalone request's
// own Reject button and each task row inside a group card.
function RejectWithNoteButton({
  request,
  label = "Reject",
  onReject,
}: {
  request: WarrantyItemRequest;
  label?: string;
  onReject: (request: WarrantyItemRequest, note?: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <>
      <button className="text-xs text-red-500 hover:underline" disabled={busy} onClick={() => setOpen(true)}>
        {label}
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Reject this request?"
        footer={
          <>
            <button className="btn-outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </button>
            <button
              className="btn-primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await onReject(request, note);
                setBusy(false);
                setOpen(false);
                setNote("");
              }}
            >
              {busy ? "Rejecting…" : "Reject"}
            </button>
          </>
        }
      >
        <label className="label">Reason (optional)</label>
        <textarea
          className="input"
          rows={2}
          placeholder="Shown to the homeowner who filed this"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          autoFocus
        />
      </Modal>
    </>
  );
}

export function WarrantyRequestCard({
  projectId,
  request,
  comments,
  reports,
  subcontractors,
  canManageRequests,
  canDeleteRequests = false,
  currentUserId,
  onApprove,
  onReject,
  onDelete,
  onSetProgress,
  onAssignSubcontractor,
  onSetSchedule,
  onUpdateCategory,
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
  canDeleteRequests?: boolean;
  currentUserId: string | null;
  onApprove: (request: WarrantyItemRequest) => Promise<void>;
  onReject: (request: WarrantyItemRequest, note?: string) => Promise<void>;
  onDelete?: (request: WarrantyItemRequest) => Promise<void>;
  onSetProgress: (request: WarrantyItemRequest, progress: WarrantyRequestProgress) => Promise<void>;
  onAssignSubcontractor: (request: WarrantyItemRequest, subcontractorId: string | null) => Promise<void>;
  onSetSchedule: (
    request: WarrantyItemRequest,
    schedule: { date: string | null; timeStart: string | null; timeEnd: string | null }
  ) => Promise<void>;
  onUpdateCategory?: (request: WarrantyItemRequest, category: string | null) => Promise<void>;
  onAddComment: (requestId: string, body: string) => Promise<void>;
  onDeleteComment: (commentId: string) => Promise<void>;
  onReportAdd: (report: InspectionReportRow) => void;
}) {
  const { notify } = useToast();
  const [acting, setActing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [scheduleDate, setScheduleDate] = useState(request.scheduled_date ?? "");
  const [scheduleStart, setScheduleStart] = useState(request.scheduled_time_start?.slice(0, 5) ?? "");
  const [scheduleEnd, setScheduleEnd] = useState(request.scheduled_time_end?.slice(0, 5) ?? "");
  const assignedSub = subcontractors.find((s) => s.id === request.subcontractor_id);
  const scheduledVisitLabel = formatScheduledVisit(request.scheduled_date, request.scheduled_time_start, request.scheduled_time_end);

  async function handleSaveSchedule() {
    setSavingSchedule(true);
    await onSetSchedule(request, {
      date: scheduleDate || null,
      timeStart: scheduleDate && scheduleStart ? scheduleStart : null,
      timeEnd: scheduleDate && scheduleStart && scheduleEnd ? scheduleEnd : null,
    });
    setSavingSchedule(false);
  }

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
            {canManageRequests && onUpdateCategory ? (
              <select
                className="input w-auto py-0.5 text-xs"
                value={request.category ?? ""}
                onChange={(e) => onUpdateCategory(request, e.target.value || null)}
              >
                <option value="">Uncategorized</option>
                {WARRANTY_REQUEST_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            ) : (
              request.category && <span className="badge bg-blueprint/10 text-blueprint">{request.category}</span>
            )}
          </div>
          {request.comment && <p className="mt-0.5 text-xs text-blueprint/60">{request.comment}</p>}
          {request.status === "rejected" && request.rejection_note && (
            <p className="mt-0.5 text-xs text-red-600">Reason: {request.rejection_note}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <span className={`${STATUS_BADGE[request.status]} text-xs`}>{request.status}</span>
          <span className={`${PROGRESS_BADGE[request.progress]} text-xs`}>{PROGRESS_LABELS[request.progress]}</span>
        </div>
      </div>

      {((request.status === "pending" && canManageRequests) || canDeleteRequests) && (
        <div className="mt-2 flex items-center gap-3">
          {request.status === "pending" && canManageRequests && (
            <>
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
              <RejectWithNoteButton request={request} onReject={onReject} />
            </>
          )}
          {canDeleteRequests && (
            <button className="text-xs text-red-500 hover:underline" disabled={deleting} onClick={() => setConfirmDelete(true)}>
              Delete
            </button>
          )}
        </div>
      )}

      {canDeleteRequests && (
        <ConfirmDialog
          open={confirmDelete}
          title="Delete this warranty request?"
          message={`"${request.title}" will be permanently removed, along with its comment thread. This can't be undone.`}
          confirmLabel="Delete"
          danger
          busy={deleting}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            setDeleting(true);
            await onDelete?.(request);
            setDeleting(false);
            setConfirmDelete(false);
          }}
        />
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

      {assignedSub && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-blueprint/60">
          {assignedSub.contact_name && <span>{assignedSub.contact_name}</span>}
          {assignedSub.phone && (
            <a href={telHref(assignedSub.phone)} className="text-blueprint hover:text-amber hover:underline">
              {assignedSub.phone}
            </a>
          )}
          {assignedSub.email && (
            <a href={`mailto:${assignedSub.email}`} className="text-blueprint hover:text-amber hover:underline">
              {assignedSub.email}
            </a>
          )}
        </div>
      )}

      <div className="mt-2.5 border-t border-blueprint/10 pt-2.5">
        <span className="mb-1.5 block text-xs font-medium text-blueprint/50">Scheduled visit</span>
        {canManageRequests ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="input w-auto py-1 text-xs"
              type="date"
              value={scheduleDate}
              onChange={(e) => setScheduleDate(e.target.value)}
            />
            <input
              className="input w-auto py-1 text-xs"
              type="time"
              value={scheduleStart}
              disabled={!scheduleDate}
              onChange={(e) => setScheduleStart(e.target.value)}
            />
            <span className="text-xs text-blueprint/40">to</span>
            <input
              className="input w-auto py-1 text-xs"
              type="time"
              value={scheduleEnd}
              disabled={!scheduleDate || !scheduleStart}
              onChange={(e) => setScheduleEnd(e.target.value)}
            />
            <button className="btn-outline px-2 py-1 text-xs" onClick={handleSaveSchedule} disabled={savingSchedule}>
              {savingSchedule ? "Saving…" : "Save"}
            </button>
          </div>
        ) : (
          <span className="text-xs text-blueprint-dark">{scheduledVisitLabel ?? "Not yet scheduled"}</span>
        )}
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
                  <span className="font-medium text-blueprint-dark">{c.sender_name || c.sender_email}</span>
                  <span className="flex items-center gap-2 text-blueprint/40">
                    {new Date(c.created_at).toLocaleDateString([], { month: "short", day: "numeric" })}
                    {c.user_id === currentUserId && (
                      <button className="hover:underline" onClick={() => onDeleteComment(c.id)}>
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

// A single ticket for one trade with several tasks inside it (e.g.
// "Electrical" with 4 tasks) — one subcontractor/schedule/inspection-report
// thread shared by the whole group (since one visit covers all of them),
// while each task is approved or rejected on its own and the group itself
// stays regardless of what happens to any individual task in it.
function WarrantyRequestGroupCard({
  projectId,
  group,
  tasks,
  comments,
  reports,
  subcontractors,
  canManageRequests,
  canDeleteRequests = false,
  onApprove,
  onReject,
  onDelete,
  onSetProgress,
  onAssignSubcontractor,
  onSetSchedule,
  onUpdateCategory,
  onAddComment,
  onDeleteComment,
  onReportAdd,
}: {
  projectId: string;
  group: WarrantyItemRequest;
  tasks: WarrantyItemRequest[];
  comments: WarrantyItemRequestComment[];
  reports: InspectionReportRow[];
  subcontractors: SubcontractorOption[];
  canManageRequests: boolean;
  canDeleteRequests?: boolean;
  currentUserId: string | null;
  onApprove: (request: WarrantyItemRequest) => Promise<void>;
  onReject: (request: WarrantyItemRequest, note?: string) => Promise<void>;
  onDelete?: (request: WarrantyItemRequest) => Promise<void>;
  onSetProgress: (request: WarrantyItemRequest, progress: WarrantyRequestProgress) => Promise<void>;
  onAssignSubcontractor: (request: WarrantyItemRequest, subcontractorId: string | null) => Promise<void>;
  onSetSchedule: (
    request: WarrantyItemRequest,
    schedule: { date: string | null; timeStart: string | null; timeEnd: string | null }
  ) => Promise<void>;
  onUpdateCategory?: (request: WarrantyItemRequest, category: string | null) => Promise<void>;
  onAddComment: (requestId: string, body: string) => Promise<void>;
  onDeleteComment: (commentId: string) => Promise<void>;
  onReportAdd: (report: InspectionReportRow) => void;
}) {
  const { notify } = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [scheduleDate, setScheduleDate] = useState(group.scheduled_date ?? "");
  const [scheduleStart, setScheduleStart] = useState(group.scheduled_time_start?.slice(0, 5) ?? "");
  const [scheduleEnd, setScheduleEnd] = useState(group.scheduled_time_end?.slice(0, 5) ?? "");
  const assignedSub = subcontractors.find((s) => s.id === group.subcontractor_id);
  const scheduledVisitLabel = formatScheduledVisit(group.scheduled_date, group.scheduled_time_start, group.scheduled_time_end);
  const groupComments = comments.filter((c) => c.request_id === group.id);
  const groupReports = reports.filter((r) => r.warranty_item_request_id === group.id);

  async function handleSaveSchedule() {
    setSavingSchedule(true);
    await onSetSchedule(group, {
      date: scheduleDate || null,
      timeStart: scheduleDate && scheduleStart ? scheduleStart : null,
      timeEnd: scheduleDate && scheduleStart && scheduleEnd ? scheduleEnd : null,
    });
    setSavingSchedule(false);
  }

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

      const res = await addInspectionReport(projectId, file.name, pub.signedUrl, group.id);
      if (!res.ok || !res.id) throw new Error(res.error ?? "Could not save report.");

      onReportAdd({
        id: res.id,
        project_id: projectId,
        checklist_item_id: null,
        warranty_item_request_id: group.id,
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
    await onAddComment(group.id, draft);
    setDraft("");
    setPosting(false);
  }

  return (
    <div className="rounded-lg border border-blueprint/20 bg-concrete/40 p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="font-medium text-blueprint-dark">{group.title}</p>
          {canManageRequests && onUpdateCategory ? (
            <select
              className="input w-auto py-0.5 text-xs"
              value={group.category ?? ""}
              onChange={(e) => onUpdateCategory(group, e.target.value || null)}
            >
              <option value="">Uncategorized</option>
              {WARRANTY_REQUEST_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          ) : (
            group.category && <span className="badge bg-blueprint/10 text-blueprint">{group.category}</span>
          )}
        </div>
        {canDeleteRequests && (
          <button className="shrink-0 text-xs text-red-500 hover:underline" disabled={deleting} onClick={() => setConfirmDelete(true)}>
            Delete group
          </button>
        )}
      </div>

      {canDeleteRequests && (
        <ConfirmDialog
          open={confirmDelete}
          title="Delete this group?"
          message={`"${group.title}" and its ${tasks.length} task${tasks.length === 1 ? "" : "s"} will be permanently removed. This can't be undone.`}
          confirmLabel="Delete"
          danger
          busy={deleting}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            setDeleting(true);
            await onDelete?.(group);
            setDeleting(false);
            setConfirmDelete(false);
          }}
        />
      )}

      <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-blueprint/10 pt-2.5">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-blueprint/50">Status:</span>
          {canManageRequests ? (
            <select
              className="input w-auto py-1 text-xs"
              value={group.progress}
              onChange={(e) => onSetProgress(group, e.target.value as WarrantyRequestProgress)}
            >
              {(Object.keys(PROGRESS_LABELS) as WarrantyRequestProgress[]).map((p) => (
                <option key={p} value={p}>
                  {PROGRESS_LABELS[p]}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-xs text-blueprint-dark">{PROGRESS_LABELS[group.progress]}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-blueprint/50">Subcontractor:</span>
          {canManageRequests ? (
            <select
              className="input w-auto py-1 text-xs"
              value={group.subcontractor_id ?? ""}
              onChange={(e) => onAssignSubcontractor(group, e.target.value || null)}
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
            <span className="text-xs text-blueprint-dark">{assignedSub ? assignedSub.company_name : "Unassigned"}</span>
          )}
        </div>
      </div>

      {assignedSub && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-blueprint/60">
          {assignedSub.contact_name && <span>{assignedSub.contact_name}</span>}
          {assignedSub.phone && (
            <a href={telHref(assignedSub.phone)} className="text-blueprint hover:text-amber hover:underline">
              {assignedSub.phone}
            </a>
          )}
          {assignedSub.email && (
            <a href={`mailto:${assignedSub.email}`} className="text-blueprint hover:text-amber hover:underline">
              {assignedSub.email}
            </a>
          )}
        </div>
      )}

      <div className="mt-2.5 border-t border-blueprint/10 pt-2.5">
        <span className="mb-1.5 block text-xs font-medium text-blueprint/50">Scheduled visit</span>
        {canManageRequests ? (
          <div className="flex flex-wrap items-center gap-2">
            <input className="input w-auto py-1 text-xs" type="date" value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)} />
            <input
              className="input w-auto py-1 text-xs"
              type="time"
              value={scheduleStart}
              disabled={!scheduleDate}
              onChange={(e) => setScheduleStart(e.target.value)}
            />
            <span className="text-xs text-blueprint/40">to</span>
            <input
              className="input w-auto py-1 text-xs"
              type="time"
              value={scheduleEnd}
              disabled={!scheduleDate || !scheduleStart}
              onChange={(e) => setScheduleEnd(e.target.value)}
            />
            <button className="btn-outline px-2 py-1 text-xs" onClick={handleSaveSchedule} disabled={savingSchedule}>
              {savingSchedule ? "Saving…" : "Save"}
            </button>
          </div>
        ) : (
          <span className="text-xs text-blueprint-dark">{scheduledVisitLabel ?? "Not yet scheduled"}</span>
        )}
      </div>

      <div className="mt-2.5 border-t border-blueprint/10 pt-2.5">
        <span className="mb-1.5 block text-xs font-medium text-blueprint/50">Tasks ({tasks.length})</span>
        <div className="space-y-1.5">
          {tasks.map((task) => (
            <GroupTaskRow key={task.id} task={task} canManageRequests={canManageRequests} onApprove={onApprove} onReject={onReject} />
          ))}
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
        {groupReports.length === 0 ? (
          <p className="text-xs text-blueprint/40">None attached yet.</p>
        ) : (
          <div className="space-y-1">
            {groupReports.map((r) => (
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
        {groupComments.length === 0 ? (
          <p className="text-xs text-blueprint/40">No comments yet.</p>
        ) : (
          <div className="mb-2 space-y-1.5">
            {groupComments.map((c) => (
              <div key={c.id} className="rounded bg-white px-2 py-1.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-blueprint-dark">{c.sender_name || c.sender_email}</span>
                  <span className="text-blueprint/40">{new Date(c.created_at).toLocaleDateString([], { month: "short", day: "numeric" })}</span>
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

function GroupTaskRow({
  task,
  canManageRequests,
  onApprove,
  onReject,
}: {
  task: WarrantyItemRequest;
  canManageRequests: boolean;
  onApprove: (request: WarrantyItemRequest) => Promise<void>;
  onReject: (request: WarrantyItemRequest, note?: string) => Promise<void>;
}) {
  const [acting, setActing] = useState(false);

  return (
    <div className="rounded border border-blueprint/10 bg-white px-2 py-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`min-w-0 flex-1 text-sm ${task.status === "rejected" ? "text-blueprint/40 line-through" : "text-blueprint-dark"}`}
        >
          {task.title}
        </span>
        <span className={`${STATUS_BADGE[task.status]} shrink-0 text-xs`}>{task.status}</span>
        {task.status === "pending" && canManageRequests && (
          <div className="flex shrink-0 items-center gap-2">
            <button
              className="text-xs text-sage-dark hover:underline"
              disabled={acting}
              onClick={async () => {
                setActing(true);
                await onApprove(task);
                setActing(false);
              }}
            >
              Approve
            </button>
            <RejectWithNoteButton request={task} onReject={onReject} />
          </div>
        )}
      </div>
      {task.comment && <p className="mt-0.5 text-xs text-blueprint/60">{task.comment}</p>}
      {task.status === "rejected" && task.rejection_note && <p className="mt-0.5 text-xs text-red-600">Reason: {task.rejection_note}</p>}
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
    const taskKey = `inspection-extract:${report.id}`;
    try {
      await run(taskKey, `Reading "${report.file_name}"…`, async () => {
        const findings = await extractFindingsFromReport(projectId, report, setStatus);
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
  selectMode,
  selected,
  onToggleSelect,
}: {
  projectId: string;
  item: WarrantyItemRow;
  reports: InspectionReportRow[];
  canManage: boolean;
  onUpdate: (id: string, patch: Partial<WarrantyItemRow>) => void;
  onRemove: (id: string) => void;
  onDetachReport: (reportId: string) => void;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
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
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-2 py-1.5">
        <input
          type="checkbox"
          checked={selectMode ? selected : item.done}
          onChange={(e) => (selectMode ? onToggleSelect() : handleToggle(e.target.checked))}
          title={selectMode ? "Select for bulk actions" : "Fixed"}
          disabled={!canManage || (!selectMode && item.status === "invalidated")}
        />
        <button
          className={`min-w-0 flex-1 basis-40 text-left text-sm ${
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
        {/* Wraps onto its own right-aligned line on a narrow screen rather
            than squeezing the status select/badge and two buttons next to
            a long, wrapped title on the same row. */}
        <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
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
            <button className="shrink-0 text-xs text-red-500 hover:underline" onClick={() => setConfirmDelete(true)}>
              Remove
            </button>
          )}
        </div>
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
