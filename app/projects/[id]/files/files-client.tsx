"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { createPortal } from "react-dom";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/Toast";
import { useBackgroundTasks } from "@/components/BackgroundTasks";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { deleteProjectFile, deleteProjectFiles, updateFileNotes, uploadProjectFile } from "@/app/projects/[id]/files/actions";
import { fetchWithRetry } from "@/lib/fetchWithRetry";
import { usePersistedSelection } from "@/lib/usePersistedSelection";
import type { FileCategory, ProjectFile } from "@/lib/types";

const CATEGORY_LABEL: Record<FileCategory, string> = {
  plan: "Plan",
  bid: "Bid",
  checklist_photo: "Checklist photo",
  rendering: "Rendering",
  finish_scan: "Finish scan",
  document: "Document",
  photo: "Photo",
  interior_design: "Interior design",
};

const CATEGORY_STYLE: Record<FileCategory, string> = {
  plan: "badge-sage",
  bid: "badge-amber",
  checklist_photo: "badge bg-blueprint/10 text-blueprint/60",
  rendering: "badge bg-blueprint text-white",
  finish_scan: "badge bg-blueprint/10 text-blueprint/60",
  document: "badge bg-blueprint/10 text-blueprint/60",
  photo: "badge-sage",
  interior_design: "badge bg-blueprint text-white",
};

// Categories offered when uploading directly from this tab — the others
// (checklist_photo, rendering, finish_scan, interior_design) only make
// sense attached to their own workflow (a checklist item, a room
// rendering, a scan, a room design) and are populated automatically from
// those tabs instead.
const UPLOAD_CATEGORIES: FileCategory[] = ["plan", "bid", "document", "photo"];

function isImage(url: string): boolean {
  return /\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(url);
}

function isPdf(url: string): boolean {
  return /\.pdf(\?|$)/i.test(url);
}

// A multi-page plan PDF (app/projects/[id]/plan/plan-client.tsx) is stored
// as one rendered-page image per sheet, each labeled "<original file name>
// — Page N" — necessary there (per-page room detection, per-page layout
// flags), but browsing them as N separate rows here is exactly the
// "each page individually" clutter this groups away. A single-page PDF's
// label has no "— Page N" suffix (already just one row, nothing to do).
const PLAN_PAGE_LABEL_RE = /^(.*) — Page (\d+)$/;

interface FileGroup {
  key: string;
  label: string;
  category: FileCategory;
  files: ProjectFile[];
}

function isFileGroup(item: ProjectFile | FileGroup): item is FileGroup {
  return "files" in item;
}

// Purely a display grouping — plan_pages/project_files underneath are
// unchanged, so Plan tab functionality (per-page room detection, deleting
// one sheet, etc.) isn't affected. Only groups by matching label prefix,
// so re-uploading a same-named PDF later would merge into the same visual
// group; harmless in practice and avoids needing a schema change to track
// a real "this came from the same upload" batch id.
function groupPlanPages(files: ProjectFile[]): (ProjectFile | FileGroup)[] {
  const groups = new Map<string, FileGroup>();
  const pageNumbers = new Map<string, number>();
  const items: (ProjectFile | FileGroup)[] = [];
  for (const f of files) {
    const match = f.category === "plan" ? f.file_name.match(PLAN_PAGE_LABEL_RE) : null;
    if (!match) {
      items.push(f);
      continue;
    }
    const key = `plan:${match[1]}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, label: match[1], category: "plan", files: [] };
      groups.set(key, group);
      items.push(group);
    }
    group.files.push(f);
    pageNumbers.set(f.id, Number(match[2]));
  }
  // The incoming list is newest-first, so a group's pages arrive in
  // reverse — sort back into reading order for the "N pages" viewer's
  // prev/next and the zip download.
  for (const group of groups.values()) {
    group.files.sort((a, b) => (pageNumbers.get(a.id) ?? 0) - (pageNumbers.get(b.id) ?? 0));
  }
  return items;
}

export function FilesClient({ projectId, initialFiles }: { projectId: string; initialFiles: ProjectFile[] }) {
  const { notify } = useToast();
  const { run, isRunning } = useBackgroundTasks();
  const uploadTaskKey = `files-upload:${projectId}`;
  const [files, setFiles] = useState<ProjectFile[]>(initialFiles);
  const [selected, setSelected] = usePersistedSelection(`files-selected:${projectId}`, () => new Set());
  const [categoryFilter, setCategoryFilter] = useState<FileCategory | "all">("all");
  const [downloading, setDownloading] = useState(false);
  const [savingNotesFor, setSavingNotesFor] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadCategory, setUploadCategory] = useState<FileCategory>("document");
  const [deleting, setDeleting] = useState<ProjectFile | null>(null);
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [viewing, setViewing] = useState<{ files: ProjectFile[]; startIndex: number } | null>(null);
  // Files mirrored in from another tab (a Plan page, a Rendering, a
  // Checklist photo, …) can't be deleted here — deleting them belongs in
  // the tab they actually live in, so they don't desync. Hidden by default
  // so what's on screen is always exactly what "Delete selected" can act
  // on, with a toggle to bring them back for browsing everything in one
  // place (this tab's original purpose) without the delete-button
  // confusion of mixing in files that can't be removed from here.
  const [showAutoMirrored, setShowAutoMirrored] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const autoMirroredCount = useMemo(() => files.filter((f) => f.source_table != null).length, [files]);
  const visibleFiles = useMemo(
    () => (showAutoMirrored ? files : files.filter((f) => f.source_table == null)),
    [files, showAutoMirrored]
  );

  const filtered = useMemo(
    () => (categoryFilter === "all" ? visibleFiles : visibleFiles.filter((f) => f.category === categoryFilter)),
    [visibleFiles, categoryFilter]
  );

  const displayItems = useMemo(() => groupPlanPages(filtered), [filtered]);

  function toggleSelectGroup(group: FileGroup) {
    const ids = group.files.map((f) => f.id);
    const allSelected = ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (allSelected ? next.delete(id) : next.add(id)));
      return next;
    });
  }

  // Selection persists across the category filter and even across tabs, so
  // it can include files not currently shown — read it off the full list,
  // not `filtered`. Only directly-uploaded files (source_table null) can be
  // deleted at all (same rule as the per-row Remove button), so a selection
  // that also includes a rendering/checklist-photo/plan-page/etc. still
  // deletes the eligible ones and just skips the rest.
  const selectedFiles = useMemo(() => files.filter((f) => selected.has(f.id)), [files, selected]);
  const deletableSelectedIds = useMemo(
    () => selectedFiles.filter((f) => f.source_table == null).map((f) => f.id),
    [selectedFiles]
  );
  const nonDeletableSelectedCount = selectedFiles.length - deletableSelectedIds.length;

  const allFilteredSelected = filtered.length > 0 && filtered.every((f) => selected.has(f.id));

  function selectAllFiltered(check: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      filtered.forEach((f) => (check ? next.add(f.id) : next.delete(f.id)));
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => {
      if (allFilteredSelected) {
        const next = new Set(prev);
        filtered.forEach((f) => next.delete(f.id));
        return next;
      }
      const next = new Set(prev);
      filtered.forEach((f) => next.add(f.id));
      return next;
    });
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleDownloadZip(fileIds: string[] | null) {
    setDownloading(true);
    try {
      await run(`files-zip:${projectId}`, "Preparing file download…", async () => {
        const res = await fetchWithRetry(`/api/projects/${projectId}/files/zip`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileIds: fileIds ?? undefined }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error ?? "Download failed.");
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "project-files.zip";
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      });
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Download failed.");
    } finally {
      setDownloading(false);
    }
  }

  async function handleNotesBlur(fileId: string, notes: string) {
    setSavingNotesFor(fileId);
    const res = await updateFileNotes(projectId, fileId, notes);
    setSavingNotesFor(null);
    if (!res.ok) {
      notify("error", res.error ?? "Could not save notes.");
    }
  }

  async function handleDeleteSelected() {
    setBulkDeleting(true);
    const res = await deleteProjectFiles(projectId, deletableSelectedIds);
    setBulkDeleting(false);
    setDeletingSelected(false);
    if (!res.ok) {
      notify("error", res.error ?? "Could not delete files.");
      return;
    }
    const deletedIds = new Set(res.deletedIds ?? deletableSelectedIds);
    setFiles((prev) => prev.filter((f) => !deletedIds.has(f.id)));
    setSelected((prev) => {
      const next = new Set(prev);
      deletedIds.forEach((id) => next.delete(id));
      return next;
    });
    notify(
      "success",
      nonDeletableSelectedCount > 0
        ? `${deletedIds.size} file${deletedIds.size === 1 ? "" : "s"} deleted — ${nonDeletableSelectedCount} skipped (not directly uploaded).`
        : `${deletedIds.size} file${deletedIds.size === 1 ? "" : "s"} deleted.`
    );
  }

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
        const res = await uploadProjectFile(projectId, pub.publicUrl, file.name, uploadCategory);
        if (!res.ok || !res.id) throw new Error(res.error ?? "Could not save file.");

        setFiles((prev) => [
          {
            id: res.id!,
            project_id: projectId,
            storage_url: pub.publicUrl,
            file_name: file.name,
            category: uploadCategory,
            source_table: null,
            source_id: null,
            notes: null,
            created_at: new Date().toISOString(),
          },
          ...prev,
        ]);
        notify("success", `Uploaded "${file.name}".`);
      });
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const categories: (FileCategory | "all")[] = [
    "all",
    "plan",
    "bid",
    "checklist_photo",
    "rendering",
    "interior_design",
    "finish_scan",
    "document",
    "photo",
  ];

  return (
    <div className="space-y-4">
      <div className="card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-blueprint-dark">File library</h2>
            <p className="text-sm text-blueprint/60">
              Every plan, bid, checklist photo, rendering, and finish scan uploaded to this construction, in
              one place — plus anything you upload directly here (contracts, permits, warranties, extra photos).
              Add notes, then download individually or in bulk.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="input w-auto text-xs"
              value={uploadCategory}
              onChange={(e) => setUploadCategory(e.target.value as FileCategory)}
              disabled={uploading || isRunning(uploadTaskKey)}
            >
              {UPLOAD_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleUpload(file);
              }}
            />
            <button
              className="btn-amber text-xs"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || isRunning(uploadTaskKey)}
            >
              {uploading || isRunning(uploadTaskKey) ? "Uploading…" : "Upload file"}
            </button>
            <button
              className="btn-outline text-xs"
              onClick={() => handleDownloadZip(selected.size > 0 ? Array.from(selected) : null)}
              disabled={downloading || isRunning(`files-zip:${projectId}`) || files.length === 0}
            >
              {downloading || isRunning(`files-zip:${projectId}`)
                ? "Preparing…"
                : selected.size > 0
                  ? `Download selected (${selected.size})`
                  : "Download all"}
            </button>
            {selected.size > 0 && (
              <button
                className="btn-outline text-xs text-red-500 hover:bg-red-50"
                onClick={() => setDeletingSelected(true)}
                disabled={bulkDeleting || deletableSelectedIds.length === 0}
                title={deletableSelectedIds.length === 0 ? "Selected files aren't directly-uploaded, so they can't be deleted here." : undefined}
              >
                Delete selected ({deletableSelectedIds.length})
              </button>
            )}
          </div>
        </div>
      </div>

      {files.length === 0 ? (
        <div className="card p-10 text-center text-sm text-blueprint/60">
          No files yet — uploads from the Plan, Payments, Checklist, Rooms, and Finish ID tabs will show up here
          automatically, or use &quot;Upload file&quot; above to add one directly.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {categories.map((c) => (
                <button
                  key={c}
                  onClick={() => setCategoryFilter(c)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                    categoryFilter === c
                      ? "border-amber-dark bg-amber-dark text-white"
                      : "border-blueprint/15 text-blueprint/60 hover:border-blueprint/30"
                  }`}
                >
                  {c === "all" ? "All" : CATEGORY_LABEL[c]}
                </button>
              ))}
            </div>
            {autoMirroredCount > 0 && (
              <label className="flex items-center gap-1.5 text-xs text-blueprint/50">
                <input
                  type="checkbox"
                  checked={showAutoMirrored}
                  onChange={(e) => setShowAutoMirrored(e.target.checked)}
                />
                Also show {autoMirroredCount} file{autoMirroredCount === 1 ? "" : "s"} from other tabs (view-only)
              </label>
            )}
          </div>

          {visibleFiles.length === 0 ? (
            <div className="card p-10 text-center text-sm text-blueprint/60">
              Every file here so far came from another tab — check &quot;Also show files from other tabs&quot; above
              to browse them, or use &quot;Upload file&quot; to add one you can manage directly here.
            </div>
          ) : (
          <div className="card overflow-hidden">
            <div className="flex items-center gap-3 border-b border-blueprint/10 bg-concrete/60 px-4 py-2 text-xs text-blueprint/60">
              <input type="checkbox" checked={allFilteredSelected} onChange={toggleSelectAll} />
              <button className="font-medium text-amber-dark hover:underline" onClick={() => selectAllFiltered(true)}>
                Check all
              </button>
              <span>·</span>
              <button className="font-medium text-amber-dark hover:underline" onClick={() => selectAllFiltered(false)}>
                Uncheck all
              </button>
              <span className="ml-auto">
                {selected.size > 0 && `${selected.size} selected · `}
                {filtered.length} file{filtered.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="divide-y divide-blueprint/10">
              {displayItems.map((item) =>
                isFileGroup(item) ? (
                  <FileGroupRow
                    key={item.key}
                    group={item}
                    selected={item.files.every((f) => selected.has(f.id))}
                    onToggleSelect={() => toggleSelectGroup(item)}
                    onDownload={() => handleDownloadZip(item.files.map((f) => f.id))}
                    onView={() => setViewing({ files: item.files, startIndex: 0 })}
                    downloading={downloading || isRunning(`files-zip:${projectId}`)}
                  />
                ) : (
                  <FileRow
                    key={item.id}
                    file={item}
                    selected={selected.has(item.id)}
                    onToggleSelect={() => toggleSelect(item.id)}
                    savingNotes={savingNotesFor === item.id}
                    onNotesBlur={(notes) => handleNotesBlur(item.id, notes)}
                    onDelete={item.source_table == null ? () => setDeleting(item) : undefined}
                    onView={
                      isImage(item.storage_url) || isPdf(item.storage_url)
                        ? () => setViewing({ files: [item], startIndex: 0 })
                        : undefined
                    }
                  />
                )
              )}
            </div>
          </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Remove this file?"
        message={`"${deleting?.file_name}" will be permanently removed from the library.`}
        confirmLabel="Remove"
        danger
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          const res = await deleteProjectFile(projectId, deleting.id);
          if (!res.ok) {
            notify("error", res.error ?? "Could not remove file.");
          } else {
            setFiles((prev) => prev.filter((f) => f.id !== deleting.id));
            notify("success", "File removed.");
          }
          setDeleting(null);
        }}
      />

      <ConfirmDialog
        open={deletingSelected}
        title="Delete selected files?"
        message={`${deletableSelectedIds.length} file${deletableSelectedIds.length === 1 ? "" : "s"} will be permanently removed from the library.${
          nonDeletableSelectedCount > 0
            ? ` ${nonDeletableSelectedCount} other selected file${nonDeletableSelectedCount === 1 ? "" : "s"} came from another tab and can't be deleted here, so ${nonDeletableSelectedCount === 1 ? "it" : "they"} will be left alone.`
            : ""
        } This cannot be undone.`}
        confirmLabel="Delete"
        danger
        busy={bulkDeleting}
        onCancel={() => setDeletingSelected(false)}
        onConfirm={handleDeleteSelected}
      />

      {viewing && (
        <FileViewerModal
          files={viewing.files}
          startIndex={viewing.startIndex}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}

function FileGroupRow({
  group,
  selected,
  onToggleSelect,
  onDownload,
  onView,
  downloading,
}: {
  group: FileGroup;
  selected: boolean;
  onToggleSelect: () => void;
  onDownload: () => void;
  onView: () => void;
  downloading: boolean;
}) {
  const cover = group.files[0];

  return (
    <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
      <input type="checkbox" checked={selected} onChange={onToggleSelect} className="mt-1 shrink-0 sm:mt-0" />

      <button
        type="button"
        onClick={onView}
        className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md bg-concrete"
        title="View pages"
      >
        {cover && isImage(cover.storage_url) ? (
          <Image src={cover.storage_url} alt={group.label} fill className="object-cover" unoptimized />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-blueprint/40">FILE</div>
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium text-blueprint-dark" title={group.label}>
            {group.label}
          </span>
          <span className={CATEGORY_STYLE[group.category]}>{CATEGORY_LABEL[group.category]}</span>
          <span className="badge bg-blueprint/10 text-blueprint/60">
            {group.files.length} page{group.files.length === 1 ? "" : "s"}
          </span>
          {cover && <span className="text-xs text-blueprint/40">{new Date(cover.created_at).toLocaleDateString()}</span>}
        </div>
      </div>

      <div className="flex shrink-0 gap-2">
        <button className="btn-outline text-xs" onClick={onView}>
          View
        </button>
        <button className="btn-ghost text-xs" onClick={onDownload} disabled={downloading}>
          {downloading ? "Preparing…" : "Download all pages"}
        </button>
      </div>
    </div>
  );
}

function FileRow({
  file,
  selected,
  onToggleSelect,
  savingNotes,
  onNotesBlur,
  onDelete,
  onView,
}: {
  file: ProjectFile;
  selected: boolean;
  onToggleSelect: () => void;
  savingNotes: boolean;
  onNotesBlur: (notes: string) => void;
  onDelete?: () => void;
  onView?: () => void;
}) {
  const [notes, setNotes] = useState(file.notes ?? "");

  return (
    <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
      <input type="checkbox" checked={selected} onChange={onToggleSelect} className="mt-1 shrink-0 sm:mt-0" />

      <button
        type="button"
        onClick={onView}
        disabled={!onView}
        className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md bg-concrete disabled:cursor-default"
        title={onView ? "View" : undefined}
      >
        {isImage(file.storage_url) ? (
          <Image src={file.storage_url} alt={file.file_name} fill className="object-cover" unoptimized />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-blueprint/40">FILE</div>
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium text-blueprint-dark" title={file.file_name}>
            {file.file_name}
          </span>
          <span className={CATEGORY_STYLE[file.category]}>{CATEGORY_LABEL[file.category]}</span>
          <span className="text-xs text-blueprint/40">{new Date(file.created_at).toLocaleDateString()}</span>
        </div>
        <input
          type="text"
          placeholder="Add a note about this file…"
          defaultValue={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={(e) => onNotesBlur(e.target.value)}
          className="mt-1.5 w-full max-w-md rounded border border-blueprint/15 px-2 py-1 text-xs text-blueprint-dark focus:border-amber focus:outline-none"
        />
        {savingNotes && <p className="mt-0.5 text-xs text-blueprint/40">Saving…</p>}
      </div>

      <div className="flex shrink-0 gap-2">
        {onView && (
          <button className="btn-outline text-xs" onClick={onView}>
            View
          </button>
        )}
        <a href={`/api/projects/${file.project_id}/files/${file.id}/download`} className="btn-ghost text-xs">
          Download
        </a>
        {onDelete && (
          <button className="text-xs text-red-500 hover:underline" onClick={onDelete}>
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.25;

// A separate full-bleed overlay rather than the shared Modal — Modal's card
// chrome (max-w-md, padded body) doesn't fit a full-size image/PDF viewer.
function FileViewerModal({
  files,
  startIndex,
  onClose,
}: {
  files: ProjectFile[];
  startIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(startIndex);
  const [zoom, setZoom] = useState(1);
  const file = files[index];
  const canGoPrev = index > 0;
  const canGoNext = index < files.length - 1;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
      else if (e.key === "ArrowRight") setIndex((i) => Math.min(files.length - 1, i + 1));
      else if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP));
      else if (e.key === "-") setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP));
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [files.length, onClose]);

  // Reset zoom when moving to a different file, so it doesn't carry over.
  useEffect(() => {
    setZoom(1);
  }, [index]);

  if (!file || typeof document === "undefined") return null;

  const image = isImage(file.storage_url);
  const pdf = isPdf(file.storage_url);

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-blueprint-dark/95 animate-fade-in" onClick={onClose}>
      <div
        className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-4 py-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-white" title={file.file_name}>
            {file.file_name}
          </p>
          {files.length > 1 && (
            <p className="text-xs text-white/50">
              Page {index + 1} of {files.length}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {(image || pdf) && (
            <div className="flex items-center gap-1 rounded-md bg-white/10 px-1 py-1">
              <button
                type="button"
                className="rounded px-2 py-1 text-sm text-white hover:bg-white/10 disabled:opacity-30"
                onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP))}
                disabled={zoom <= ZOOM_MIN}
                aria-label="Zoom out"
              >
                −
              </button>
              <span className="w-11 text-center text-xs text-white/70">{Math.round(zoom * 100)}%</span>
              <button
                type="button"
                className="rounded px-2 py-1 text-sm text-white hover:bg-white/10 disabled:opacity-30"
                onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP))}
                disabled={zoom >= ZOOM_MAX}
                aria-label="Zoom in"
              >
                +
              </button>
              {zoom !== 1 && (
                <button
                  type="button"
                  className="rounded px-2 py-1 text-xs text-white/70 hover:bg-white/10"
                  onClick={() => setZoom(1)}
                >
                  Reset
                </button>
              )}
            </div>
          )}
          <a
            href={`/api/projects/${file.project_id}/files/${file.id}/download`}
            className="rounded-md bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/20"
          >
            Download
          </a>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/20"
          >
            Close
          </button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-auto" onClick={(e) => e.stopPropagation()}>
        {image ? (
          <div className="flex min-h-full items-center justify-center p-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- needs
                unconstrained natural sizing under a CSS zoom transform, which
                next/image's layout modes don't support cleanly. */}
            <img
              src={file.storage_url}
              alt={file.file_name}
              className="max-h-[85vh] max-w-full select-none object-contain transition-transform duration-150"
              style={{ transform: `scale(${zoom})` }}
              draggable={false}
            />
          </div>
        ) : pdf ? (
          <PdfViewer file={file} zoom={zoom} />
        ) : (
          <div className="flex h-full items-center justify-center px-4 text-center text-sm text-white/70">
            This file type can&apos;t be previewed in-app — use Download above instead.
          </div>
        )}

        {canGoPrev && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIndex((i) => Math.max(0, i - 1));
            }}
            className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/10 px-3 py-2 text-lg text-white hover:bg-white/20"
            aria-label="Previous page"
          >
            ‹
          </button>
        )}
        {canGoNext && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIndex((i) => Math.min(files.length - 1, i + 1));
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/10 px-3 py-2 text-lg text-white hover:bg-white/20"
            aria-label="Next page"
          >
            ›
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}

// Rendered at a fixed multiple of its fit-to-width size up front, then just
// resized via CSS on zoom — re-rendering the PDF canvas on every zoom click
// would be needlessly slow for a control meant to feel instant.
const PDF_RENDER_OVERSAMPLE = 2;

function PdfViewer({ file, zoom }: { file: ProjectFile; zoom: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<PDFPageProxy[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fitWidth, setFitWidth] = useState(600);

  useEffect(() => {
    function measure() {
      if (containerRef.current) setFitWidth(Math.max(200, containerRef.current.clientWidth - 32));
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let doc: PDFDocumentProxy | null = null;
    setPages(null);
    setError(null);
    (async () => {
      try {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        // Fetched through the same-origin download proxy rather than the
        // public Supabase Storage URL directly — that URL renders fine in an
        // <img>/<iframe> (no CORS involved in a plain navigation/embed), but
        // a script-driven fetch() is CORS-checked and this avoids relying on
        // Storage's CORS config being permissive enough to allow it.
        const res = await fetch(`/api/projects/${file.project_id}/files/${file.id}/download`);
        if (!res.ok) throw new Error("Could not download this PDF.");
        const arrayBuffer = await res.arrayBuffer();
        if (cancelled) return;
        doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        if (cancelled) return;
        const loaded: PDFPageProxy[] = [];
        for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
          loaded.push(await doc.getPage(pageNum));
        }
        if (!cancelled) setPages(loaded);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load this PDF.");
      }
    })();
    return () => {
      cancelled = true;
      doc?.destroy();
    };
  }, [file.project_id, file.id]);

  return (
    <div ref={containerRef} className="flex min-h-full flex-col items-center gap-3 p-4">
      {error && <p className="text-sm text-white/70">{error}</p>}
      {!error && !pages && <p className="text-sm text-white/50">Loading PDF…</p>}
      {pages?.map((page, i) => <PdfPageCanvas key={i} page={page} fitWidth={fitWidth} zoom={zoom} />)}
    </div>
  );
}

function PdfPageCanvas({ page, fitWidth, zoom }: { page: PDFPageProxy; fitWidth: number; zoom: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [displaySize, setDisplaySize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (!canvas || !context) return;
      const naturalWidth = page.getViewport({ scale: 1 }).width;
      const fitScale = fitWidth / naturalWidth;
      const renderViewport = page.getViewport({ scale: fitScale * PDF_RENDER_OVERSAMPLE });
      canvas.width = renderViewport.width;
      canvas.height = renderViewport.height;
      await page.render({ canvasContext: context, viewport: renderViewport }).promise;
      if (!cancelled) {
        setDisplaySize({ width: renderViewport.width / PDF_RENDER_OVERSAMPLE, height: renderViewport.height / PDF_RENDER_OVERSAMPLE });
      }
    })();
    return () => {
      cancelled = true;
    };
    // fitWidth only changes on container resize (rare) — re-rendering per
    // zoom tick is handled by the CSS resize below instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, fitWidth]);

  return (
    <canvas
      ref={canvasRef}
      className="block bg-white shadow-md"
      style={displaySize ? { width: displaySize.width * zoom, height: displaySize.height * zoom } : undefined}
    />
  );
}
