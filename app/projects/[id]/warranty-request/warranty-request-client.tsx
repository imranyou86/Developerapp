"use client";

import { useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/Toast";
import { useBackgroundTasks } from "@/components/BackgroundTasks";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  addWarrantyItem,
  addWarrantyPhoto,
  deleteWarrantyItem,
  deleteWarrantyPhoto,
  toggleWarrantyItem,
  updateWarrantyComment,
} from "@/app/projects/[id]/warranty-request/actions";

interface WarrantyPhoto {
  id: string;
  storage_url: string;
}

interface WarrantyItemRow {
  id: string;
  title: string;
  done: boolean;
  comment: string | null;
  sort_order: number;
  checklist_photos: WarrantyPhoto[];
}

export function WarrantyRequestClient({
  projectId,
  initialItems,
}: {
  projectId: string;
  initialItems: WarrantyItemRow[];
}) {
  const { notify } = useToast();
  const [items, setItems] = useState<WarrantyItemRow[]>(initialItems);
  const [newTitle, setNewTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const fixed = items.filter((i) => i.done).length;

  function updateItem(id: string, patch: Partial<WarrantyItemRow>) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }
  function removeItem(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
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
        { id: res.id!, title: newTitle.trim(), done: false, comment: null, sort_order: prev.length, checklist_photos: [] },
      ]);
      setNewTitle("");
    }
    setAdding(false);
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="card p-5">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="font-semibold text-blueprint-dark">Warranty Request</h2>
          <span className="text-xs text-blueprint/50">
            {fixed}/{items.length} fixed
          </span>
        </div>
        <p className="mb-4 text-sm text-blueprint/60">
          List anything that needs to be fixed under warranty, one item at a time — each becomes a checklist item
          the team can track through to done.
        </p>

        <div className="h-1.5 w-full overflow-hidden rounded-full bg-concrete">
          <div
            className="h-full bg-sage"
            style={{ width: items.length ? `${(fixed / items.length) * 100}%` : "0%" }}
          />
        </div>

        <div className="mt-4 space-y-2">
          {items.length === 0 && <p className="text-sm text-blueprint/40">No warranty items yet.</p>}
          {items.map((item) => (
            <WarrantyItem key={item.id} projectId={projectId} item={item} onUpdate={updateItem} onRemove={removeItem} />
          ))}
        </div>

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
      </div>
    </div>
  );
}

function WarrantyItem({
  projectId,
  item,
  onUpdate,
  onRemove,
}: {
  projectId: string;
  item: WarrantyItemRow;
  onUpdate: (id: string, patch: Partial<WarrantyItemRow>) => void;
  onRemove: (id: string) => void;
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
    const res = await toggleWarrantyItem(projectId, item.id, done);
    if (!res.ok) {
      notify("error", res.error ?? "Could not update item.");
      onUpdate(item.id, { done: !done });
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
        <input type="checkbox" checked={item.done} onChange={(e) => handleToggle(e.target.checked)} title="Fixed" />
        <button
          className={`flex-1 text-left text-sm ${item.done ? "text-blueprint/40 line-through" : "text-blueprint-dark"}`}
          onClick={() => setExpanded((e) => !e)}
        >
          {item.title}
        </button>
        <button
          className={`shrink-0 text-xs hover:underline ${
            item.comment || item.checklist_photos.length > 0 ? "text-amber-dark" : "text-blueprint/40"
          }`}
          onClick={() => setExpanded((e) => !e)}
        >
          {item.comment && "📝 "}
          {item.checklist_photos.length > 0 && `📷${item.checklist_photos.length} `}
          {expanded ? "Notes & photos ▾" : "Notes & photos ▸"}
        </button>
        <button className="text-xs text-red-500 hover:underline" onClick={() => setConfirmDelete(true)}>
          Remove
        </button>
      </div>

      {expanded && (
        <div className="space-y-2 border-t border-blueprint/10 p-3">
          <textarea
            className="input"
            rows={2}
            placeholder="Notes…"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onBlur={handleSaveComment}
          />
          {savingComment && <p className="text-xs text-blueprint/40">Saving…</p>}

          {item.checklist_photos.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {item.checklist_photos.map((photo) => (
                <div key={photo.id} className="group relative h-16 w-16 overflow-hidden rounded-md">
                  <Image src={photo.storage_url} alt="" fill className="object-cover" unoptimized />
                  <button
                    className="absolute inset-0 hidden items-center justify-center bg-blueprint-dark/60 text-xs text-white group-hover:flex"
                    onClick={() => handleDeletePhoto(photo.id)}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

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
        </div>
      )}

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
    </div>
  );
}
