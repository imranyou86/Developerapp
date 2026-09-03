"use client";

import { useState, useTransition } from "react";
import { useToast } from "@/components/Toast";
import { Modal } from "@/components/Modal";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { addBudgetItem, deleteBudgetItem, updateBudgetItem } from "@/app/projects/[id]/budget/actions";

interface BudgetItemRow {
  id: string;
  item: string;
  budgeted: number;
  actual: number;
}

interface RoomWithBudget {
  id: string;
  name: string;
  budget_items: BudgetItemRow[];
}

function currency(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function BudgetClient({
  projectId,
  initialRooms,
}: {
  projectId: string;
  initialRooms: RoomWithBudget[];
}) {
  const { notify } = useToast();
  const [rooms, setRooms] = useState<RoomWithBudget[]>(initialRooms);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<{ roomId: string; item: BudgetItemRow } | null>(null);
  const [deleting, setDeleting] = useState<{ roomId: string; item: BudgetItemRow } | null>(null);
  const [pending, startTransition] = useTransition();

  const totalBudgeted = rooms.reduce((sum, r) => sum + r.budget_items.reduce((s, i) => s + Number(i.budgeted), 0), 0);
  const totalActual = rooms.reduce((sum, r) => sum + r.budget_items.reduce((s, i) => s + Number(i.actual), 0), 0);
  const remaining = totalBudgeted - totalActual;

  function updateRoomItems(roomId: string, items: BudgetItemRow[]) {
    setRooms((prev) => prev.map((r) => (r.id === roomId ? { ...r, budget_items: items } : r)));
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryCard label="Total budgeted" value={currency(totalBudgeted)} />
        <SummaryCard label="Total actual" value={currency(totalActual)} />
        <SummaryCard
          label={remaining < 0 ? "Over budget" : "Remaining"}
          value={currency(Math.abs(remaining))}
          tone={remaining < 0 ? "danger" : "sage"}
        />
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-blueprint-dark">Budget by room</h2>
        <button className="btn-amber" onClick={() => setAddOpen(true)} disabled={rooms.length === 0}>
          + Add line item
        </button>
      </div>

      {rooms.length === 0 ? (
        <div className="card p-10 text-center text-sm text-blueprint/60">Add rooms first to start tracking budget.</div>
      ) : (
        <div className="space-y-4">
          {rooms.map((room) => {
            const roomBudgeted = room.budget_items.reduce((s, i) => s + Number(i.budgeted), 0);
            const roomActual = room.budget_items.reduce((s, i) => s + Number(i.actual), 0);
            return (
              <div key={room.id} className="card p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-semibold text-blueprint-dark">{room.name}</h3>
                  <span className="text-sm text-blueprint/60">
                    {currency(roomActual)} / {currency(roomBudgeted)}
                  </span>
                </div>
                {room.budget_items.length === 0 ? (
                  <p className="text-xs text-blueprint/50">No line items yet.</p>
                ) : (
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="text-xs uppercase tracking-wide text-blueprint/50">
                        <th className="py-1 font-medium">Item</th>
                        <th className="py-1 font-medium">Budgeted</th>
                        <th className="py-1 font-medium">Actual</th>
                        <th className="py-1" />
                      </tr>
                    </thead>
                    <tbody>
                      {room.budget_items.map((item) => (
                        <tr key={item.id} className="border-t border-blueprint/5">
                          <td className="py-1.5">{item.item}</td>
                          <td className="py-1.5">{currency(Number(item.budgeted))}</td>
                          <td className={`py-1.5 ${Number(item.actual) > Number(item.budgeted) ? "text-red-600" : ""}`}>
                            {currency(Number(item.actual))}
                          </td>
                          <td className="py-1.5 text-right">
                            <button
                              className="mr-3 text-xs text-blueprint/50 hover:underline"
                              onClick={() => setEditing({ roomId: room.id, item })}
                            >
                              Edit
                            </button>
                            <button
                              className="text-xs text-red-500 hover:underline"
                              onClick={() => setDeleting({ roomId: room.id, item })}
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>
      )}

      <AddBudgetItemModal
        open={addOpen}
        rooms={rooms}
        onClose={() => setAddOpen(false)}
        onAdd={async (roomId, input) => {
          const res = await addBudgetItem(projectId, roomId, input);
          if (!res.ok || !res.id) {
            notify("error", res.error ?? "Could not add line item.");
            return;
          }
          const room = rooms.find((r) => r.id === roomId);
          if (room) {
            updateRoomItems(roomId, [...room.budget_items, { id: res.id, ...input }]);
          }
          notify("success", "Line item added.");
          setAddOpen(false);
        }}
      />

      {editing && (
        <EditBudgetItemModal
          entry={editing}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            const res = await updateBudgetItem(projectId, editing.item.id, input);
            if (!res.ok) {
              notify("error", res.error ?? "Could not save changes.");
              return;
            }
            const room = rooms.find((r) => r.id === editing.roomId);
            if (room) {
              updateRoomItems(
                editing.roomId,
                room.budget_items.map((i) => (i.id === editing.item.id ? { ...i, ...input } : i))
              );
            }
            notify("success", "Line item updated.");
            setEditing(null);
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Remove line item?"
        message={`Remove "${deleting?.item.item}" from the budget?`}
        confirmLabel="Remove"
        danger
        busy={pending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          startTransition(async () => {
            const res = await deleteBudgetItem(projectId, deleting.item.id);
            if (!res.ok) {
              notify("error", res.error ?? "Could not remove line item.");
            } else {
              const room = rooms.find((r) => r.id === deleting.roomId);
              if (room) {
                updateRoomItems(deleting.roomId, room.budget_items.filter((i) => i.id !== deleting.item.id));
              }
              notify("success", "Line item removed.");
            }
            setDeleting(null);
          });
        }}
      />
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone?: "danger" | "sage" }) {
  return (
    <div className="card p-4">
      <p className="text-xs uppercase tracking-wide text-blueprint/50">{label}</p>
      <p
        className={`mt-1 text-xl font-semibold ${
          tone === "danger" ? "text-red-600" : tone === "sage" ? "text-sage-dark" : "text-blueprint-dark"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function AddBudgetItemModal({
  open,
  rooms,
  onClose,
  onAdd,
}: {
  open: boolean;
  rooms: RoomWithBudget[];
  onClose: () => void;
  onAdd: (roomId: string, input: { item: string; budgeted: number; actual: number }) => void;
}) {
  const [roomId, setRoomId] = useState(rooms[0]?.id ?? "");
  const [item, setItem] = useState("");
  const [budgeted, setBudgeted] = useState("");
  const [actual, setActual] = useState("");
  const [pending, startTransition] = useTransition();

  function reset() {
    setItem("");
    setBudgeted("");
    setActual("");
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Add budget line item"
      footer={
        <>
          <button className="btn-outline" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={pending || !item.trim() || !roomId}
            onClick={() =>
              startTransition(async () => {
                await onAdd(roomId, { item, budgeted: Number(budgeted) || 0, actual: Number(actual) || 0 });
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
          <label className="label">Room</label>
          <select className="input" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Item</label>
          <input className="input" value={item} onChange={(e) => setItem(e.target.value)} placeholder="e.g. Tile & installation" autoFocus />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Budgeted</label>
            <input className="input" type="number" step="0.01" value={budgeted} onChange={(e) => setBudgeted(e.target.value)} />
          </div>
          <div>
            <label className="label">Actual</label>
            <input className="input" type="number" step="0.01" value={actual} onChange={(e) => setActual(e.target.value)} />
          </div>
        </div>
      </div>
    </Modal>
  );
}

function EditBudgetItemModal({
  entry,
  onClose,
  onSave,
}: {
  entry: { roomId: string; item: BudgetItemRow };
  onClose: () => void;
  onSave: (input: { budgeted: number; actual: number }) => void;
}) {
  const [budgeted, setBudgeted] = useState(entry.item.budgeted.toString());
  const [actual, setActual] = useState(entry.item.actual.toString());
  const [pending, startTransition] = useTransition();

  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit "${entry.item.item}"`}
      footer={
        <>
          <button className="btn-outline" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await onSave({ budgeted: Number(budgeted) || 0, actual: Number(actual) || 0 });
              })
            }
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Budgeted</label>
          <input className="input" type="number" step="0.01" value={budgeted} onChange={(e) => setBudgeted(e.target.value)} autoFocus />
        </div>
        <div>
          <label className="label">Actual</label>
          <input className="input" type="number" step="0.01" value={actual} onChange={(e) => setActual(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}
