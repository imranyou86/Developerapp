"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { useToast } from "@/components/Toast";
import { updateFileNotes } from "@/app/projects/[id]/files/actions";
import type { FileCategory, ProjectFile } from "@/lib/types";

const CATEGORY_LABEL: Record<FileCategory, string> = {
  plan: "Plan",
  bid: "Bid",
  checklist_photo: "Checklist photo",
  rendering: "Rendering",
  finish_scan: "Finish scan",
};

const CATEGORY_STYLE: Record<FileCategory, string> = {
  plan: "badge-sage",
  bid: "badge-amber",
  checklist_photo: "badge bg-blueprint/10 text-blueprint/60",
  rendering: "badge bg-blueprint text-white",
  finish_scan: "badge bg-blueprint/10 text-blueprint/60",
};

function isImage(url: string): boolean {
  return /\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(url);
}

export function FilesClient({ projectId, initialFiles }: { projectId: string; initialFiles: ProjectFile[] }) {
  const { notify } = useToast();
  const [files, setFiles] = useState<ProjectFile[]>(initialFiles);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [categoryFilter, setCategoryFilter] = useState<FileCategory | "all">("all");
  const [downloading, setDownloading] = useState(false);
  const [savingNotesFor, setSavingNotesFor] = useState<string | null>(null);

  const filtered = useMemo(
    () => (categoryFilter === "all" ? files : files.filter((f) => f.category === categoryFilter)),
    [files, categoryFilter]
  );

  const allFilteredSelected = filtered.length > 0 && filtered.every((f) => selected.has(f.id));

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
      const res = await fetch(`/api/projects/${projectId}/files/zip`, {
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

  const categories: (FileCategory | "all")[] = ["all", "plan", "bid", "checklist_photo", "rendering", "finish_scan"];

  return (
    <div className="space-y-4">
      <div className="card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-blueprint-dark">File library</h2>
            <p className="text-sm text-blueprint/60">
              Every plan page, bid, checklist photo, rendering, and finish scan uploaded to this construction, in
              one place. Add notes, then download individually or in bulk.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              className="btn-outline text-xs"
              onClick={() => handleDownloadZip(selected.size > 0 ? Array.from(selected) : null)}
              disabled={downloading || files.length === 0}
            >
              {downloading
                ? "Preparing…"
                : selected.size > 0
                  ? `Download selected (${selected.size})`
                  : "Download all"}
            </button>
          </div>
        </div>
      </div>

      {files.length === 0 ? (
        <div className="card p-10 text-center text-sm text-blueprint/60">
          No files yet — uploads from the Plan, Payments, Checklist, Rooms, and Finish ID tabs will show up here
          automatically.
        </div>
      ) : (
        <>
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

          <div className="card overflow-hidden">
            <div className="flex items-center gap-3 border-b border-blueprint/10 bg-concrete/60 px-4 py-2 text-xs text-blueprint/60">
              <input type="checkbox" checked={allFilteredSelected} onChange={toggleSelectAll} />
              <span>{allFilteredSelected ? "Deselect all" : "Select all"}</span>
              <span className="ml-auto">
                {filtered.length} file{filtered.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="divide-y divide-blueprint/10">
              {filtered.map((f) => (
                <FileRow
                  key={f.id}
                  file={f}
                  selected={selected.has(f.id)}
                  onToggleSelect={() => toggleSelect(f.id)}
                  savingNotes={savingNotesFor === f.id}
                  onNotesBlur={(notes) => handleNotesBlur(f.id, notes)}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function FileRow({
  file,
  selected,
  onToggleSelect,
  savingNotes,
  onNotesBlur,
}: {
  file: ProjectFile;
  selected: boolean;
  onToggleSelect: () => void;
  savingNotes: boolean;
  onNotesBlur: (notes: string) => void;
}) {
  const [notes, setNotes] = useState(file.notes ?? "");

  return (
    <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
      <input type="checkbox" checked={selected} onChange={onToggleSelect} className="mt-1 shrink-0 sm:mt-0" />

      <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md bg-concrete">
        {isImage(file.storage_url) ? (
          <Image src={file.storage_url} alt={file.file_name} fill className="object-cover" unoptimized />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-blueprint/40">FILE</div>
        )}
      </div>

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

      <a href={`/api/projects/${file.project_id}/files/${file.id}/download`} className="btn-ghost shrink-0 text-xs">
        Download
      </a>
    </div>
  );
}
