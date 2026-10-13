"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/Toast";
import { useBackgroundTasks } from "@/components/BackgroundTasks";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Modal } from "@/components/Modal";
import { MoodBoardCanvas } from "@/components/MoodBoardCanvas";
import { fetchWithRetry } from "@/lib/fetchWithRetry";
import { SIGNED_URL_TTL_SECONDS } from "@/lib/storageClient";
import { saveMoodBoard, deleteMoodBoard } from "@/app/interior-design/mood-board-actions";
import type { MoodBoard, MoodBoardItem } from "@/lib/types";

interface RoomOption {
  id: string;
  name: string;
  type: string | null;
  width: number | null;
  depth: number | null;
}

type ItemType = MoodBoardItem["type"];

interface DetectedComponent {
  label: string;
  dataUrl: string;
  selected: boolean;
}

export function MoodBoardClient({
  projectId,
  projectName,
  projectAddress,
  rooms,
  initialBoards,
}: {
  projectId: string;
  projectName: string;
  projectAddress: string | null;
  rooms: RoomOption[];
  initialBoards: MoodBoard[];
}) {
  const { notify } = useToast();
  const { run, isRunning } = useBackgroundTasks();

  const [boards, setBoards] = useState<MoodBoard[]>(initialBoards);
  const [selectedRoomId, setSelectedRoomId] = useState<string>(rooms[0]?.id ?? "");
  const [addType, setAddType] = useState<ItemType>("inspiration");
  const [addLabel, setAddLabel] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [detectingItemId, setDetectingItemId] = useState<string | null>(null);
  const [detected, setDetected] = useState<DetectedComponent[] | null>(null);
  const [addingDetected, setAddingDetected] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedRoom = rooms.find((r) => r.id === selectedRoomId) ?? null;
  const board = boards.find((b) => b.room_id === selectedRoomId) ?? null;
  const items = board?.items ?? [];
  const [notesDraft, setNotesDraft] = useState(board?.notes ?? "");
  const notesDirty = notesDraft !== (board?.notes ?? "");

  const addTaskKey = `mood-board-add:${selectedRoomId}`;
  const generateTaskKey = `mood-board-generate:${selectedRoomId}`;
  const notesTaskKey = `mood-board-notes:${selectedRoomId}`;
  const exportTaskKey = `mood-board-export:${projectId}`;
  const adding = isRunning(addTaskKey);
  const generating = isRunning(generateTaskKey);
  const savingNotes = isRunning(notesTaskKey);
  const exportingBoards = exporting || isRunning(exportTaskKey);

  function handleRoomSelect(roomId: string) {
    setSelectedRoomId(roomId);
    const nextBoard = boards.find((b) => b.room_id === roomId) ?? null;
    setNotesDraft(nextBoard?.notes ?? "");
  }

  function upsertLocalBoard(roomId: string, patch: Partial<MoodBoard>) {
    setBoards((prev) => {
      const existing = prev.find((b) => b.room_id === roomId);
      if (existing) {
        return prev.map((b) => (b.room_id === roomId ? { ...b, ...patch } : b));
      }
      return [
        ...prev,
        {
          id: patch.id ?? crypto.randomUUID(),
          project_id: projectId,
          room_id: roomId,
          notes: null,
          items: [],
          collage_image_url: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...patch,
        },
      ];
    });
  }

  async function uploadItemFile(file: File): Promise<string> {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not signed in.");

    const ext = file.name.split(".").pop() || "jpg";
    const path = `${user.id}/${projectId}/${selectedRoomId}-${Date.now()}-${crypto.randomUUID()}.${ext}`;
    const { error: uploadError } = await supabase.storage.from("mood-board-photos").upload(path, file, {
      contentType: file.type || undefined,
    });
    if (uploadError) throw new Error(uploadError.message);

    const { data: pub, error: signError } = await supabase.storage
      .from("mood-board-photos")
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (signError || !pub) throw new Error(signError?.message ?? "Could not get a URL for the uploaded file.");
    return pub.signedUrl;
  }

  async function uploadBlob(blob: Blob, ext: string, suffix = "collage"): Promise<string> {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not signed in.");

    const path = `${user.id}/${projectId}/${selectedRoomId}-${suffix}-${Date.now()}-${crypto.randomUUID()}.${ext}`;
    const { error: uploadError } = await supabase.storage.from("mood-board-photos").upload(path, blob, {
      contentType: blob.type,
    });
    if (uploadError) throw new Error(uploadError.message);

    const { data: pub, error: signError } = await supabase.storage
      .from("mood-board-photos")
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (signError || !pub) throw new Error(signError?.message ?? "Could not get a URL for the uploaded file.");
    return pub.signedUrl;
  }

  function dataUrlToBlob(dataUrl: string): Blob {
    const [header, base64] = dataUrl.split(",");
    const mime = header.match(/data:(.*);base64/)?.[1] ?? "image/jpeg";
    const byteChars = atob(base64);
    const bytes = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  async function handleAddItem(file: File) {
    if (!selectedRoom) return;
    try {
      await run(addTaskKey, `Uploading ${addType === "material" ? "material" : "inspiration photo"}…`, async () => {
        const storageUrl = await uploadItemFile(file);
        const newItem: MoodBoardItem = {
          id: crypto.randomUUID(),
          type: addType,
          storage_url: storageUrl,
          label: addLabel.trim() || null,
        };
        const nextItems = [...items, newItem];
        const res = await saveMoodBoard(projectId, selectedRoomId, {
          roomName: selectedRoom.name,
          notes: board?.notes ?? null,
          items: nextItems,
          collageImageUrl: board?.collage_image_url ?? null,
        });
        if (!res.ok) throw new Error(res.error ?? "Could not save.");
        upsertLocalBoard(selectedRoomId, { id: res.id, items: nextItems });
        setAddLabel("");
        notify("success", addType === "material" ? "Material added." : "Inspiration photo added.");
      });
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Upload failed.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleRemoveItem(itemId: string) {
    if (!selectedRoom || !board) return;
    const nextItems = items.filter((it) => it.id !== itemId);
    const res = await saveMoodBoard(projectId, selectedRoomId, {
      roomName: selectedRoom.name,
      notes: board.notes,
      items: nextItems,
      collageImageUrl: board.collage_image_url,
    });
    if (!res.ok) {
      notify("error", res.error ?? "Could not remove item.");
      return;
    }
    upsertLocalBoard(selectedRoomId, { items: nextItems });
  }

  // Reads an inspiration photo with Claude vision and crops out each
  // distinct furniture/fixture/material it finds, for the person to pick
  // from — see app/api/claude/detect-mood-board-components/route.ts.
  // Nothing is added to the board until they confirm a selection below.
  async function handleDetectComponents(item: MoodBoardItem) {
    setDetectingItemId(item.id);
    try {
      await run(`mood-board-detect:${item.id}`, "Finding components in this photo…", async () => {
        const res = await fetchWithRetry("/api/claude/detect-mood-board-components", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageUrl: item.storage_url }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Could not find components in this photo.");
        if (!json.items || json.items.length === 0) {
          notify("error", "Didn't find any distinct components in this photo.");
          return;
        }
        setDetected((json.items as { label: string; dataUrl: string }[]).map((c) => ({ ...c, selected: true })));
      });
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Could not find components in this photo.");
    } finally {
      setDetectingItemId(null);
    }
  }

  async function handleAddDetectedComponents() {
    if (!detected || !selectedRoom) return;
    const chosen = detected.filter((c) => c.selected);
    if (chosen.length === 0) {
      setDetected(null);
      return;
    }
    setAddingDetected(true);
    try {
      await run(`mood-board-add-detected:${selectedRoomId}`, `Adding ${chosen.length} material${chosen.length === 1 ? "" : "s"}…`, async () => {
        const newItems: MoodBoardItem[] = [];
        for (const c of chosen) {
          const storageUrl = await uploadBlob(dataUrlToBlob(c.dataUrl), "jpg", "component");
          newItems.push({ id: crypto.randomUUID(), type: "material", storage_url: storageUrl, label: c.label });
        }
        const nextItems = [...items, ...newItems];
        const res = await saveMoodBoard(projectId, selectedRoomId, {
          roomName: selectedRoom.name,
          notes: board?.notes ?? null,
          items: nextItems,
          collageImageUrl: board?.collage_image_url ?? null,
        });
        if (!res.ok) throw new Error(res.error ?? "Could not save.");
        upsertLocalBoard(selectedRoomId, { id: res.id, items: nextItems });
        notify("success", `${chosen.length} material${chosen.length === 1 ? "" : "s"} added.`);
        setDetected(null);
      });
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Could not add components.");
    } finally {
      setAddingDetected(false);
    }
  }

  // Persists a freeform arrangement from the canvas — called once at drag
  // end (see components/MoodBoardCanvas.tsx), not per pixel of movement.
  async function handleArrangeChange(nextItems: MoodBoardItem[]) {
    if (!selectedRoom) return;
    const res = await saveMoodBoard(projectId, selectedRoomId, {
      roomName: selectedRoom.name,
      notes: board?.notes ?? null,
      items: nextItems,
      collageImageUrl: board?.collage_image_url ?? null,
    });
    if (!res.ok) {
      notify("error", res.error ?? "Could not save the arrangement.");
      return;
    }
    upsertLocalBoard(selectedRoomId, { id: res.id, items: nextItems });
  }

  async function handleSaveNotes() {
    if (!selectedRoom) return;
    try {
      await run(notesTaskKey, "Saving notes…", async () => {
        const res = await saveMoodBoard(projectId, selectedRoomId, {
          roomName: selectedRoom.name,
          notes: notesDraft.trim() || null,
          items,
          collageImageUrl: board?.collage_image_url ?? null,
        });
        if (!res.ok) throw new Error(res.error ?? "Could not save notes.");
        upsertLocalBoard(selectedRoomId, { id: res.id, notes: notesDraft.trim() || null });
      });
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Could not save notes.");
    }
  }

  async function handleGenerate() {
    if (!selectedRoom) return;
    if (items.length === 0) {
      notify("error", "Add at least one inspiration photo or material first.");
      return;
    }
    try {
      await run(generateTaskKey, `Generating mood board — ${selectedRoom.name}…`, async () => {
        const res = await fetchWithRetry("/api/mood-board/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            roomName: selectedRoom.name,
            projectName,
            items: items.map((it) => ({
              url: it.storage_url,
              type: it.type,
              label: it.label,
              x: it.x,
              y: it.y,
              width: it.width,
              height: it.height,
            })),
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Mood board generation failed.");

        const byteChars = atob(json.base64);
        const bytes = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
        const blob = new Blob([bytes], { type: json.mimeType ?? "image/png" });
        const collageUrl = await uploadBlob(blob, "png");

        const saveRes = await saveMoodBoard(projectId, selectedRoomId, {
          roomName: selectedRoom.name,
          notes: board?.notes ?? null,
          items,
          collageImageUrl: collageUrl,
        });
        if (!saveRes.ok) throw new Error(saveRes.error ?? "Could not save mood board.");
        upsertLocalBoard(selectedRoomId, { id: saveRes.id, collage_image_url: collageUrl });
        notify("success", "Mood board generated.");
      });
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Mood board generation failed.");
    }
  }

  async function downloadUrl(url: string, filename: string) {
    try {
      const res = await fetchWithRetry(url);
      if (!res.ok) throw new Error("Could not fetch the file.");
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
    } catch {
      notify("error", "Could not download the file.");
    }
  }

  async function handleDownload() {
    if (!board?.collage_image_url || !selectedRoom) return;
    await downloadUrl(board.collage_image_url, `${selectedRoom.name.replace(/[^a-z0-9]+/gi, "-")}-mood-board.png`);
  }

  async function handleExportProject() {
    setExporting(true);
    try {
      await run(exportTaskKey, `Exporting all mood boards — ${projectName}…`, async () => {
        const res = await fetchWithRetry(`/api/projects/${projectId}/mood-boards/export`, { method: "POST" });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error ?? "Could not export mood boards.");
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${projectName.replace(/[^a-z0-9]+/gi, "-")}-mood-boards.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        notify("success", "Mood boards exported.");
      });
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Could not export mood boards.");
    } finally {
      setExporting(false);
    }
  }

  if (rooms.length === 0) {
    return <p className="text-sm text-blueprint/50">No rooms yet — add rooms in Rooms &amp; Tasks first, then come back here.</p>;
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-xs">
          <label className="label">Room</label>
          <select className="input" value={selectedRoomId} onChange={(e) => handleRoomSelect(e.target.value)}>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="btn-outline text-xs" disabled={exportingBoards} onClick={handleExportProject}>
          {exportingBoards ? "Exporting…" : "Export all mood boards (PDF)"}
        </button>
      </div>

      {selectedRoom && (
        <div className="space-y-4">
          <div>
            <p className="text-xs font-medium text-blueprint/50">
              {projectName}
              {projectAddress ? ` — ${projectAddress}` : ""}
            </p>
            <h3 className="text-base font-semibold text-blueprint-dark">{selectedRoom.name}</h3>
          </div>

          <div className="rounded-lg border border-blueprint/10 bg-concrete/50 p-3">
            <div className="mb-2 flex flex-wrap items-end gap-2">
              <div>
                <label className="label">Add as</label>
                <div className="flex gap-1">
                  {(["inspiration", "material"] as ItemType[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`rounded-full border px-3 py-1 text-xs capitalize ${
                        addType === t ? "border-amber bg-amber/15 text-amber-dark" : "border-blueprint/15 text-blueprint/60"
                      }`}
                      onClick={() => setAddType(t)}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div className="min-w-[160px] flex-1">
                <label className="label">Label (optional)</label>
                <input
                  className="input"
                  placeholder={addType === "material" ? "e.g. White oak flooring" : "e.g. Pinterest living room"}
                  value={addLabel}
                  onChange={(e) => setAddLabel(e.target.value)}
                />
              </div>
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleAddItem(file);
                  }}
                />
                <button type="button" className="btn-outline text-xs" disabled={adding} onClick={() => fileInputRef.current?.click()}>
                  {adding ? "Uploading…" : `+ Add ${addType === "material" ? "material photo" : "inspiration photo"}`}
                </button>
              </div>
            </div>
          </div>

          <div>
            <label className="label">Notes — palette, theme, anything to keep in mind (optional)</label>
            <textarea className="input" rows={2} value={notesDraft} onChange={(e) => setNotesDraft(e.target.value)} />
            {notesDirty && (
              <button type="button" className="btn-ghost mt-1 px-2 py-1 text-xs" disabled={savingNotes} onClick={handleSaveNotes}>
                {savingNotes ? "Saving…" : "Save notes"}
              </button>
            )}
          </div>

          {items.length > 0 && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="label mb-0">{items.length} item{items.length === 1 ? "" : "s"}</label>
                <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setCanvasOpen(true)}>
                  Open board — arrange items
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
                {items.map((it) => (
                  <div key={it.id} className="group relative aspect-square overflow-hidden rounded-md bg-concrete">
                    {/* eslint-disable-next-line @next/next/no-img-element -- signed, expiring storage URL, not a next/image remote source */}
                    <img src={it.storage_url} alt={it.label ?? it.type} className="h-full w-full object-cover" />
                    <span
                      className={`absolute left-1 top-1 rounded px-1 text-[9px] font-medium text-white ${
                        it.type === "material" ? "bg-amber" : "bg-blueprint"
                      }`}
                    >
                      {it.type === "material" ? "Material" : "Inspo"}
                    </span>
                    {it.label && (
                      <span className="absolute inset-x-0 bottom-0 truncate bg-black/50 px-1 py-0.5 text-[9px] text-white">
                        {it.label}
                      </span>
                    )}
                    <div className="absolute right-1 top-1 hidden flex-col items-end gap-1 group-hover:flex">
                      {it.type === "inspiration" && (
                        <button
                          type="button"
                          className="rounded bg-black/60 px-1 py-0.5 text-[9px] text-white disabled:opacity-60"
                          disabled={detectingItemId === it.id}
                          onClick={() => handleDetectComponents(it)}
                        >
                          {detectingItemId === it.id ? "Finding…" : "Find materials"}
                        </button>
                      )}
                      <button type="button" className="rounded bg-black/60 px-1 py-0.5 text-[9px] text-white" onClick={() => handleRemoveItem(it.id)}>
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-amber text-xs" disabled={generating || items.length === 0} onClick={handleGenerate}>
              {generating ? "Generating…" : board?.collage_image_url ? "Regenerate mood board" : "Generate mood board"}
            </button>
            {board?.collage_image_url && (
              <button type="button" className="btn-ghost text-xs" onClick={handleDownload}>
                Download
              </button>
            )}
            {board && (
              <button type="button" className="text-xs text-red-500 hover:underline" onClick={() => setDeleting(true)}>
                Delete board
              </button>
            )}
          </div>

          {board?.collage_image_url && (
            <div className="overflow-hidden rounded-lg border border-blueprint/10">
              {/* eslint-disable-next-line @next/next/no-img-element -- signed, expiring storage URL, not a next/image remote source */}
              <img src={board.collage_image_url} alt={`${selectedRoom.name} mood board`} className="w-full" />
            </div>
          )}
        </div>
      )}

      {canvasOpen && selectedRoom && (
        <MoodBoardCanvas
          roomName={selectedRoom.name}
          items={items}
          onChange={handleArrangeChange}
          onClose={() => setCanvasOpen(false)}
          onGenerate={handleGenerate}
          generating={generating}
          collageImageUrl={board?.collage_image_url ?? null}
          onDownload={handleDownload}
        />
      )}

      {detected && (
        <Modal
          open
          onClose={() => setDetected(null)}
          title="Components found in this photo"
          footer={
            <>
              <button type="button" className="btn-outline" disabled={addingDetected} onClick={() => setDetected(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={addingDetected || detected.every((c) => !c.selected)}
                onClick={handleAddDetectedComponents}
              >
                {addingDetected ? "Adding…" : `Add selected (${detected.filter((c) => c.selected).length})`}
              </button>
            </>
          }
        >
          <p className="mb-3 text-xs text-blueprint/50">
            Uncheck anything you don&apos;t want — each one you keep is added as its own cropped material item.
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {detected.map((c, i) => (
              <label
                key={i}
                className={`cursor-pointer overflow-hidden rounded-md border-2 ${c.selected ? "border-amber" : "border-transparent"}`}
              >
                <div className="relative aspect-square bg-concrete">
                  {/* eslint-disable-next-line @next/next/no-img-element -- data: URI crop, not a next/image remote source */}
                  <img src={c.dataUrl} alt={c.label} className="h-full w-full object-cover" />
                  <input
                    type="checkbox"
                    className="absolute right-1 top-1 h-4 w-4"
                    checked={c.selected}
                    onChange={() =>
                      setDetected((prev) => (prev ? prev.map((x, xi) => (xi === i ? { ...x, selected: !x.selected } : x)) : prev))
                    }
                  />
                </div>
                <p className="truncate px-1 py-1 text-xs text-blueprint/70">{c.label}</p>
              </label>
            ))}
          </div>
        </Modal>
      )}

      <ConfirmDialog
        open={deleting}
        title="Delete this mood board?"
        message="Every item and the generated collage for this room will be permanently removed."
        confirmLabel="Delete"
        danger
        onCancel={() => setDeleting(false)}
        onConfirm={async () => {
          if (!board) return;
          const res = await deleteMoodBoard(projectId, board.id);
          if (!res.ok) {
            notify("error", res.error ?? "Could not delete this mood board.");
          } else {
            setBoards((prev) => prev.filter((b) => b.id !== board.id));
            setNotesDraft("");
          }
          setDeleting(false);
        }}
      />
    </div>
  );
}
