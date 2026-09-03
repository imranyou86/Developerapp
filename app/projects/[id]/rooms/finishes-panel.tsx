"use client";

import { useState, useTransition } from "react";
import { useToast } from "@/components/Toast";
import { Modal } from "@/components/Modal";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FINISH_CATEGORIES, productsByCategory } from "@/lib/finishes-db";
import { addFinish, deleteFinish } from "@/app/projects/[id]/rooms/actions";
import type { RoomWithRelations } from "@/app/projects/[id]/rooms/room-types";
import type { FinishCategory } from "@/lib/types";

function currency(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function FinishesPanel({
  projectId,
  room,
  onRoomUpdated,
}: {
  projectId: string;
  room: RoomWithRelations;
  onRoomUpdated: (room: RoomWithRelations) => void;
}) {
  const { notify } = useToast();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-blueprint-dark">Finishes &amp; fixtures</h4>
        <button className="btn-outline text-xs" onClick={() => setOpen(true)}>
          + Add finish
        </button>
      </div>

      {room.finishes.length === 0 ? (
        <p className="text-xs text-blueprint/50">No finishes added yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-blueprint/50">
                <th className="py-1 pr-4 font-medium">Item</th>
                <th className="py-1 pr-4 font-medium">Category</th>
                <th className="py-1 pr-4 font-medium">Brand / Model</th>
                <th className="py-1 pr-4 font-medium">Price</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {room.finishes.map((f) => (
                <tr key={f.id} className="border-t border-blueprint/5">
                  <td className="py-1.5 pr-4">{f.name}</td>
                  <td className="py-1.5 pr-4 text-blueprint/60">{f.category}</td>
                  <td className="py-1.5 pr-4 text-blueprint/60">{f.brand ?? "—"}</td>
                  <td className="py-1.5 pr-4">{currency(f.price)}</td>
                  <td className="py-1.5 text-right">
                    <button className="text-xs text-red-500 hover:underline" onClick={() => setDeleting(f.id)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AddFinishModal
        open={open}
        onClose={() => setOpen(false)}
        onAdd={async (input) => {
          const res = await addFinish(projectId, room.id, input);
          if (!res.ok) {
            notify("error", res.error ?? "Could not add finish.");
            return;
          }
          onRoomUpdated({
            ...room,
            finishes: [...room.finishes, { id: crypto.randomUUID(), ...input }],
          });
          notify("success", "Finish added.");
          setOpen(false);
        }}
      />

      <ConfirmDialog
        open={!!deleting}
        title="Remove finish?"
        message="This finish/fixture will be permanently removed from the room."
        confirmLabel="Remove"
        danger
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          const res = await deleteFinish(projectId, deleting);
          if (!res.ok) {
            notify("error", res.error ?? "Could not remove finish.");
          } else {
            onRoomUpdated({ ...room, finishes: room.finishes.filter((f) => f.id !== deleting) });
          }
          setDeleting(null);
        }}
      />
    </div>
  );
}

function AddFinishModal({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (input: { name: string; category: FinishCategory; brand: string | null; price: number | null }) => void;
}) {
  const [category, setCategory] = useState<FinishCategory>(FINISH_CATEGORIES[0]);
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [price, setPrice] = useState("");
  const [pending, startTransition] = useTransition();

  const products = productsByCategory(category);

  function reset() {
    setName("");
    setBrand("");
    setPrice("");
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Add finish or fixture"
      footer={
        <>
          <button className="btn-outline" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={pending || !name.trim()}
            onClick={() =>
              startTransition(async () => {
                await onAdd({
                  name,
                  category,
                  brand: brand.trim() || null,
                  price: price ? Number(price) : null,
                });
                reset();
              })
            }
          >
            {pending ? "Adding…" : "Add"}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="label">Category</label>
          <select
            className="input"
            value={category}
            onChange={(e) => setCategory(e.target.value as FinishCategory)}
          >
            {FINISH_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        {products.length > 0 && (
          <div>
            <label className="label">Browse common products</label>
            <div className="max-h-32 space-y-1 overflow-y-auto rounded-lg border border-blueprint/10 p-1">
              {products.map((p) => (
                <button
                  key={`${p.brand}-${p.name}`}
                  type="button"
                  className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs hover:bg-concrete"
                  onClick={() => {
                    setName(p.name);
                    setBrand(p.brand);
                    setPrice(p.price.toString());
                  }}
                >
                  <span>
                    <span className="font-medium">{p.brand}</span> — {p.name}
                  </span>
                  <span className="text-blueprint/50">{currency(p.price)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <label className="label">Item name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Master bath tile" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Brand / model</label>
            <input className="input" value={brand} onChange={(e) => setBrand(e.target.value)} />
          </div>
          <div>
            <label className="label">Price</label>
            <input className="input" type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
        </div>
      </div>
    </Modal>
  );
}
