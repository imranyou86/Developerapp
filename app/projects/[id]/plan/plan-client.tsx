"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/Toast";
import { Modal } from "@/components/Modal";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { fetchWithRetry } from "@/lib/fetchWithRetry";
import {
  addDetectedRooms,
  addPlanPage,
  deletePlanPage,
  setPlanPageLayout,
  type DetectedRoomInput,
} from "@/app/projects/[id]/plan/actions";

interface PlanPageRow {
  id: string;
  storage_url: string;
  label: string;
  sort_order: number;
  is_layout: boolean;
}

interface DetectedRoom {
  name: string;
  type: string;
  floor: number;
  width: number | null;
  depth: number | null;
  estimated: boolean;
  source_sheet: string;
}

export function PlanClient({
  projectId,
  initialPages,
  existingRoomNames,
}: {
  projectId: string;
  initialPages: PlanPageRow[];
  existingRoomNames: string[];
}) {
  const { notify } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pages, setPages] = useState<PlanPageRow[]>(initialPages);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string>("");
  const [detecting, setDetecting] = useState(false);
  const [deletingPage, setDeletingPage] = useState<PlanPageRow | null>(null);

  const [detected, setDetected] = useState<{
    rooms: DetectedRoom[];
    bedroom_count: number;
    bathroom_count: number;
  } | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [savingRooms, setSavingRooms] = useState(false);

  const existingLower = new Set(existingRoomNames.map((n) => n.toLowerCase()));

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in.");

      for (const file of Array.from(files)) {
        if (file.type === "application/pdf") {
          await uploadPdfPages(supabase, user.id, file);
        } else if (file.type.startsWith("image/")) {
          await uploadImagePage(supabase, user.id, file);
        } else {
          notify("error", `Skipped "${file.name}": unsupported file type.`);
        }
      }
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
      setUploadStatus("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function uploadImagePage(
    supabase: ReturnType<typeof createClient>,
    userId: string,
    file: File
  ) {
    const path = `${userId}/${projectId}/${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from("plan-pages").upload(path, file, {
      contentType: file.type,
      upsert: false,
    });
    if (uploadError) throw new Error(`Upload of "${file.name}" failed: ${uploadError.message}`);

    const { data: pub } = supabase.storage.from("plan-pages").getPublicUrl(path);
    const sortOrder = pages.length;
    const res = await addPlanPage(projectId, pub.publicUrl, file.name, sortOrder);
    if (!res.ok) throw new Error(res.error ?? "Could not save plan page.");

    setPages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), storage_url: pub.publicUrl, label: file.name, sort_order: sortOrder, is_layout: true },
    ]);
    notify("success", `Added "${file.name}".`);
  }

  async function uploadPdfPages(
    supabase: ReturnType<typeof createClient>,
    userId: string,
    file: File
  ) {
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    // Every page of a multi-page PDF is rendered and stored as its own
    // labeled page — floors and ADUs frequently live on separate sheets.
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      setUploadStatus(`Rendering ${file.name} — page ${pageNum} of ${pdf.numPages}…`);
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

      const label = pdf.numPages > 1 ? `${file.name} — Page ${pageNum}` : file.name;
      const path = `${userId}/${projectId}/${Date.now()}-${pageNum}-${file.name}.png`;

      const { error: uploadError } = await supabase.storage.from("plan-pages").upload(path, blob, {
        contentType: "image/png",
        upsert: false,
      });
      if (uploadError) throw new Error(`Upload of "${label}" failed: ${uploadError.message}`);

      const { data: pub } = supabase.storage.from("plan-pages").getPublicUrl(path);
      const sortOrder = pages.length + pageNum - 1;
      const res = await addPlanPage(projectId, pub.publicUrl, label, sortOrder);
      if (!res.ok) throw new Error(`Saving "${label}" failed: ${res.error}`);

      setPages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), storage_url: pub.publicUrl, label, sort_order: sortOrder, is_layout: true },
      ]);
    }
    notify("success", `Added ${pdf.numPages} page(s) from "${file.name}".`);
  }

  async function handleTogglePageLayout(page: PlanPageRow, isLayout: boolean) {
    setPages((prev) => prev.map((p) => (p.id === page.id ? { ...p, is_layout: isLayout } : p)));
    const res = await setPlanPageLayout(projectId, page.id, isLayout);
    if (!res.ok) {
      notify("error", res.error ?? "Could not update page.");
      setPages((prev) => prev.map((p) => (p.id === page.id ? { ...p, is_layout: !isLayout } : p)));
    }
  }

  const layoutPages = pages.filter((p) => p.is_layout);

  async function handleDetect() {
    if (layoutPages.length === 0) {
      notify("error", "Mark at least one page as a floor plan layout first (checkbox under each thumbnail).");
      return;
    }
    setDetecting(true);
    try {
      const res = await fetchWithRetry("/api/claude/detect-rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pages: layoutPages.map((p) => ({ label: p.label, url: p.storage_url })),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Room detection failed.");
      const result = json as { rooms: DetectedRoom[]; bedroom_count: number; bathroom_count: number };
      setDetected(result);
      // Pre-select every room that doesn't already exist.
      const initial = new Set<number>();
      result.rooms.forEach((r, i) => {
        if (!existingLower.has(r.name.toLowerCase())) initial.add(i);
      });
      setSelected(initial);
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Room detection failed.");
    } finally {
      setDetecting(false);
    }
  }

  async function handleSaveSelectedRooms() {
    if (!detected) return;
    setSavingRooms(true);
    try {
      const toAdd: DetectedRoomInput[] = detected.rooms
        .filter((_, i) => selected.has(i))
        .map((r) => ({
          name: r.name,
          type: r.type,
          floor: r.floor,
          width: r.width,
          depth: r.depth,
          estimated: r.estimated,
        }));
      const res = await addDetectedRooms(projectId, toAdd);
      if (!res.ok) throw new Error(res.error ?? "Could not add rooms.");
      notify("success", `Added ${toAdd.length} room(s).`);
      setDetected(null);
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Could not add rooms.");
    } finally {
      setSavingRooms(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-blueprint-dark">Architect&apos;s plan</h2>
            <p className="text-sm text-blueprint/60">
              Upload the plan as PDF or image. Every page of a multi-page PDF is stored and read
              together, so multi-floor and ADU sheets are all covered. Uncheck &quot;Floor plan
              layout&quot; under any elevation, section, or detail sheets below — room detection
              and cost estimates only read pages left checked, which is faster and more accurate.
            </p>
          </div>
          <div className="flex gap-2">
            <button className="btn-outline" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              {uploading ? uploadStatus || "Uploading…" : "Upload plan"}
            </button>
            <button className="btn-amber" onClick={handleDetect} disabled={detecting || layoutPages.length === 0}>
              {detecting
                ? "Analyzing plan…"
                : `Detect rooms from plan (${layoutPages.length} page${layoutPages.length === 1 ? "" : "s"})`}
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,image/*"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>
      </div>

      {pages.length === 0 ? (
        <div className="card p-10 text-center text-sm text-blueprint/60">No plan pages uploaded yet.</div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {pages.map((p) => (
            <div key={p.id} className={`card overflow-hidden ${p.is_layout ? "" : "opacity-60"}`}>
              <div className="relative aspect-[4/3] bg-concrete">
                <Image src={p.storage_url} alt={p.label} fill className="object-contain" unoptimized />
              </div>
              <div className="flex items-center justify-between gap-2 p-2">
                <span className="truncate text-xs text-blueprint/70" title={p.label}>
                  {p.label}
                </span>
                <button
                  className="text-xs text-red-600 hover:underline"
                  onClick={() => setDeletingPage(p)}
                >
                  Remove
                </button>
              </div>
              <label className="flex items-center gap-1.5 border-t border-blueprint/10 px-2 py-1.5 text-xs text-blueprint/60">
                <input
                  type="checkbox"
                  checked={p.is_layout}
                  onChange={(e) => handleTogglePageLayout(p, e.target.checked)}
                />
                Floor plan layout
              </label>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!deletingPage}
        title="Remove plan page?"
        message={`Remove "${deletingPage?.label}" from this construction's plan?`}
        confirmLabel="Remove"
        danger
        onCancel={() => setDeletingPage(null)}
        onConfirm={async () => {
          if (!deletingPage) return;
          const res = await deletePlanPage(projectId, deletingPage.id);
          if (!res.ok) {
            notify("error", res.error ?? "Could not remove page.");
          } else {
            setPages((prev) => prev.filter((p) => p.id !== deletingPage.id));
            notify("success", "Plan page removed.");
          }
          setDeletingPage(null);
        }}
      />

      <Modal
        open={!!detected}
        onClose={() => setDetected(null)}
        title="Detected rooms"
        footer={
          <>
            <button className="btn-outline" onClick={() => setDetected(null)} disabled={savingRooms}>
              Cancel
            </button>
            <button className="btn-primary" onClick={handleSaveSelectedRooms} disabled={savingRooms || selected.size === 0}>
              {savingRooms ? "Adding…" : `Add ${selected.size} room(s)`}
            </button>
          </>
        }
      >
        {detected && (
          <div className="space-y-3">
            <p className="text-sm text-blueprint/70">
              {detected.bedroom_count} bedroom(s), {detected.bathroom_count} bathroom(s) detected across all
              sheets. Rooms already in this project are unchecked by default.
            </p>
            <div className="flex items-center gap-3 text-xs text-blueprint/60">
              <button
                className="font-medium text-amber-dark hover:underline"
                onClick={() => setSelected(new Set(detected.rooms.map((_, i) => i)))}
              >
                Check all
              </button>
              <span>·</span>
              <button className="font-medium text-amber-dark hover:underline" onClick={() => setSelected(new Set())}>
                Uncheck all
              </button>
            </div>
            <div className="max-h-96 space-y-1 overflow-y-auto">
              {detected.rooms.map((r, i) => {
                const already = existingLower.has(r.name.toLowerCase());
                return (
                  <label
                    key={i}
                    className={`flex items-start gap-3 rounded-lg border p-2 text-sm ${
                      already ? "border-blueprint/5 bg-concrete/50" : "border-blueprint/10"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={selected.has(i)}
                      onChange={(e) =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(i);
                          else next.delete(i);
                          return next;
                        })
                      }
                    />
                    <span className="flex-1">
                      <span className="font-medium text-blueprint-dark">{r.name}</span>
                      {already && <span className="badge-amber ml-2">already added</span>}
                      {r.estimated && <span className="badge-sage ml-2">estimated dims</span>}
                      <br />
                      <span className="text-xs text-blueprint/50">
                        {r.type} · Floor {r.floor} · {r.width && r.depth ? `${r.width}ft × ${r.depth}ft` : "no dims"} ·{" "}
                        {r.source_sheet}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
