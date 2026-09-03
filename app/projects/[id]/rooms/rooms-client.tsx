"use client";

import { useState, useTransition } from "react";
import { Modal } from "@/components/Modal";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useToast } from "@/components/Toast";
import { addRoom, deleteRoom } from "@/app/projects/[id]/rooms/actions";
import { RoomCard } from "@/app/projects/[id]/rooms/room-card";
import type { RoomWithRelations } from "@/app/projects/[id]/rooms/room-types";

const ROOM_TYPES = [
  "Bedroom",
  "Bathroom",
  "Kitchen",
  "Living Room",
  "Dining Room",
  "Office",
  "Closet",
  "Hallway",
  "Laundry",
  "Mechanical",
  "Garage",
  "Other",
];

export function RoomsClient({
  projectId,
  initialRooms,
}: {
  projectId: string;
  initialRooms: RoomWithRelations[];
}) {
  const { notify } = useToast();
  const [rooms, setRooms] = useState<RoomWithRelations[]>(initialRooms);
  const [addOpen, setAddOpen] = useState(false);
  const [deleting, setDeleting] = useState<RoomWithRelations | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-blueprint-dark">Rooms &amp; tasks</h2>
        <button className="btn-amber" onClick={() => setAddOpen(true)}>
          + Add room
        </button>
      </div>

      {rooms.length === 0 ? (
        <div className="card p-10 text-center text-sm text-blueprint/60">
          No rooms yet. Add one manually, or detect rooms from the Plan tab.
        </div>
      ) : (
        <div className="space-y-4">
          {rooms.map((room) => (
            <RoomCard
              key={room.id}
              projectId={projectId}
              room={room}
              onDeleteRequested={() => setDeleting(room)}
              onRoomUpdated={(updated) =>
                setRooms((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
              }
            />
          ))}
        </div>
      )}

      <AddRoomModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdd={async (input) => {
          const res = await addRoom(projectId, input);
          if (!res.ok || !res.id) {
            notify("error", res.error ?? "Could not add room.");
            return;
          }
          setRooms((prev) => [
            ...prev,
            {
              id: res.id!,
              name: input.name,
              type: input.type || null,
              width: input.width,
              depth: input.depth,
              floor: input.floor,
              estimated: false,
              tasks: [],
              finishes: [],
              renderings: [],
            },
          ]);
          notify("success", "Room added.");
          setAddOpen(false);
        }}
      />

      <ConfirmDialog
        open={!!deleting}
        title="Delete room?"
        message={`Delete "${deleting?.name}" and all of its tasks, finishes, and renderings? This cannot be undone.`}
        confirmLabel="Delete"
        danger
        busy={pending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          startTransition(async () => {
            const res = await deleteRoom(projectId, deleting.id);
            if (!res.ok) {
              notify("error", res.error ?? "Delete failed.");
            } else {
              setRooms((prev) => prev.filter((r) => r.id !== deleting.id));
              notify("success", "Room deleted.");
            }
            setDeleting(null);
          });
        }}
      />
    </div>
  );
}

function AddRoomModal({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (input: { name: string; type: string; width: number | null; depth: number | null; floor: number | null }) => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState(ROOM_TYPES[0]);
  const [width, setWidth] = useState("");
  const [depth, setDepth] = useState("");
  const [floor, setFloor] = useState("1");
  const [pending, startTransition] = useTransition();

  function reset() {
    setName("");
    setType(ROOM_TYPES[0]);
    setWidth("");
    setDepth("");
    setFloor("1");
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Add room"
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
                  type,
                  width: width ? Number(width) : null,
                  depth: depth ? Number(depth) : null,
                  floor: floor ? Number(floor) : null,
                });
                reset();
              })
            }
          >
            {pending ? "Adding…" : "Add room"}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="label">Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Primary Bedroom" autoFocus />
        </div>
        <div>
          <label className="label">Type</label>
          <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
            {ROOM_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label">Width (ft)</label>
            <input className="input" type="number" value={width} onChange={(e) => setWidth(e.target.value)} />
          </div>
          <div>
            <label className="label">Depth (ft)</label>
            <input className="input" type="number" value={depth} onChange={(e) => setDepth(e.target.value)} />
          </div>
          <div>
            <label className="label">Floor</label>
            <input className="input" type="number" value={floor} onChange={(e) => setFloor(e.target.value)} />
          </div>
        </div>
      </div>
    </Modal>
  );
}
