"use client";

import { useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/Toast";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  addChecklistItem,
  addChecklistPhoto,
  deleteChecklistItem,
  deleteChecklistPhoto,
  toggleChecklistItem,
  updateChecklistComment,
} from "@/app/projects/[id]/checklist/actions";
import type { ChecklistPhase } from "@/lib/types";

interface ChecklistPhoto {
  id: string;
  storage_url: string;
}

interface ChecklistItemRow {
  id: string;
  phase: ChecklistPhase;
  title: string;
  done: boolean;
  comment: string | null;
  sort_order: number;
  checklist_photos: ChecklistPhoto[];
}

export function ChecklistClient({
  projectId,
  initialItems,
}: {
  projectId: string;
  initialItems: ChecklistItemRow[];
}) {
  const [items, setItems] = useState<ChecklistItemRow[]>(initialItems);

  const rough = items.filter((i) => i.phase === "rough");
  const finish = items.filter((i) => i.phase === "finish");

  function updateItem(id: string, patch: Partial<ChecklistItemRow>) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }
  function removeItem(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }
  function addItem(item: ChecklistItemRow) {
    setItems((prev) => [...prev, item]);
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <ChecklistPhaseColumn
        projectId={projectId}
        phase="rough"
        title="Rough-in"
        items={rough}
        onUpdate={updateItem}
        onRemove={removeItem}
        onAdd={addItem}
      />
      <ChecklistPhaseColumn
        projectId={projectId}
        phase="finish"
        title="Finish"
        items={finish}
        onUpdate={updateItem}
        onRemove={removeItem}
        onAdd={addItem}
      />
    </div>
  );
}

function ChecklistPhaseColumn({
  projectId,
  phase,
  title,
  items,
  onUpdate,
  onRemove,
  onAdd,
}: {
  projectId: string;
  phase: ChecklistPhase;
  title: string;
  items: ChecklistItemRow[];
  onUpdate: (id: string, patch: Partial<ChecklistItemRow>) => void;
  onRemove: (id: string) => void;
  onAdd: (item: ChecklistItemRow) => void;
}) {
  const { notify } = useToast();
  const [newTitle, setNewTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const done = items.filter((i) => i.done).length;

  async function handleAdd() {
    if (!newTitle.trim()) return;
    setAdding(true);
    const res = await addChecklistItem(projectId, phase, newTitle);
    if (!res.ok || !res.id) {
      notify("error", res.error ?? "Could not add item.");
    } else {
      onAdd({ id: res.id, phase, title: newTitle.trim(), done: false, comment: null, sort_order: items.length, checklist_photos: [] });
      setNewTitle("");
    }
    setAdding(false);
  }

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold text-blueprint-dark">{title}</h3>
        <span className="text-xs text-blueprint/50">
          {done}/{items.length}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-concrete">
        <div
          className="h-full bg-sage"
          style={{ width: items.length ? `${(done / items.length) * 100}%` : "0%" }}
        />
      </div>

      <div className="mt-4 space-y-2">
        {items.map((item) => (
          <ChecklistItemRow key={item.id} projectId={projectId} item={item} onUpdate={onUpdate} onRemove={onRemove} />
        ))}
      </div>

      <div className="mt-3 flex gap-2">
        <input
          className="input flex-1"
          placeholder="Add custom item"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
        />
        <button className="btn-outline" onClick={handleAdd} disabled={adding || !newTitle.trim()}>
          Add
        </button>
      </div>
    </div>
  );
}

function ChecklistItemRow({
  projectId,
  item,
  onUpdate,
  onRemove,
}: {
  projectId: string;
  item: ChecklistItemRow;
  onUpdate: (id: string, patch: Partial<ChecklistItemRow>) => void;
  onRemove: (id: string) => void;
}) {
  const { notify } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [comment, setComment] = useState(item.comment ?? "");
  const [savingComment, setSavingComment] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function handleToggle(done: boolean) {
    onUpdate(item.id, { done });
    const res = await toggleChecklistItem(projectId, item.id, done);
    if (!res.ok) {
      notify("error", res.error ?? "Could not update item.");
      onUpdate(item.id, { done: !done });
    }
  }

  async function handleSaveComment() {
    setSavingComment(true);
    const res = await updateChecklistComment(projectId, item.id, comment);
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
      const res = await addChecklistPhoto(projectId, item.id, pub.publicUrl);
      if (!res.ok) throw new Error(res.error ?? "Could not save photo.");

      onUpdate(item.id, {
        checklist_photos: [...item.checklist_photos, { id: crypto.randomUUID(), storage_url: pub.publicUrl }],
      });
      notify("success", "Photo added.");
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Photo upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function handleDeletePhoto(photoId: string) {
    const res = await deleteChecklistPhoto(projectId, photoId);
    if (!res.ok) {
      notify("error", res.error ?? "Could not remove photo.");
    } else {
      onUpdate(item.id, { checklist_photos: item.checklist_photos.filter((p) => p.id !== photoId) });
    }
  }

  return (
    <div className="rounded-lg border border-blueprint/10">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <input type="checkbox" checked={item.done} onChange={(e) => handleToggle(e.target.checked)} />
        <button
          className={`flex-1 text-left text-sm ${item.done ? "text-blueprint/40 line-through" : "text-blueprint-dark"}`}
          onClick={() => setExpanded((e) => !e)}
        >
          {item.title}
        </button>
        {(item.comment || item.checklist_photos.length > 0) && (
          <span className="text-xs text-blueprint/40">
            {item.comment && "📝"} {item.checklist_photos.length > 0 && `📷${item.checklist_photos.length}`}
          </span>
        )}
        <button className="text-xs text-blueprint/40 hover:text-amber" onClick={() => setExpanded((e) => !e)}>
          {expanded ? "▾" : "▸"}
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
            {uploading ? "Uploading…" : "+ Add photo"}
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
        title="Remove checklist item?"
        message={`"${item.title}" will be permanently removed from the checklist.`}
        confirmLabel="Remove"
        danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          const res = await deleteChecklistItem(projectId, item.id);
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
