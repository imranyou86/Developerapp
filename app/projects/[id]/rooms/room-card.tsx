"use client";

import { useState, useTransition } from "react";
import { useToast } from "@/components/Toast";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  addTask,
  deleteTask,
  toggleTask,
  updateRoomDimensions,
} from "@/app/projects/[id]/rooms/actions";
import { RenderingPanel } from "@/app/projects/[id]/rooms/rendering-panel";
import { FinishesPanel } from "@/app/projects/[id]/rooms/finishes-panel";
import type { RoomWithRelations } from "@/app/projects/[id]/rooms/room-types";

export function RoomCard({
  projectId,
  room,
  onDeleteRequested,
  onRoomUpdated,
}: {
  projectId: string;
  room: RoomWithRelations;
  onDeleteRequested: () => void;
  onRoomUpdated: (room: RoomWithRelations) => void;
}) {
  const { notify } = useToast();
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState(room.width?.toString() ?? "");
  const [depth, setDepth] = useState(room.depth?.toString() ?? "");
  const [savingDims, startSavingDims] = useTransition();
  const [newTask, setNewTask] = useState("");
  const [newTaskDue, setNewTaskDue] = useState("");
  const [addingTask, startAddingTask] = useTransition();
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);

  const tasksDone = room.tasks.filter((t) => t.done).length;

  function saveDims() {
    startSavingDims(async () => {
      const w = width ? Number(width) : null;
      const d = depth ? Number(depth) : null;
      const res = await updateRoomDimensions(projectId, room.id, w, d);
      if (!res.ok) {
        notify("error", res.error ?? "Could not save dimensions.");
        return;
      }
      onRoomUpdated({ ...room, width: w, depth: d });
      notify("success", "Dimensions saved.");
    });
  }

  function handleAddTask() {
    if (!newTask.trim()) return;
    startAddingTask(async () => {
      const res = await addTask(projectId, room.id, newTask, newTaskDue || null);
      if (!res.ok) {
        notify("error", res.error ?? "Could not add task.");
        return;
      }
      onRoomUpdated({
        ...room,
        tasks: [
          ...room.tasks,
          { id: crypto.randomUUID(), title: newTask.trim(), due_date: newTaskDue || null, done: false },
        ],
      });
      setNewTask("");
      setNewTaskDue("");
    });
  }

  async function handleToggleTask(taskId: string, done: boolean) {
    onRoomUpdated({ ...room, tasks: room.tasks.map((t) => (t.id === taskId ? { ...t, done } : t)) });
    const res = await toggleTask(projectId, taskId, done);
    if (!res.ok) {
      notify("error", res.error ?? "Could not update task.");
      onRoomUpdated({ ...room, tasks: room.tasks.map((t) => (t.id === taskId ? { ...t, done: !done } : t)) });
    }
  }

  return (
    <div className="card">
      <button
        className="flex w-full items-center justify-between gap-4 p-5 text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center gap-3">
          <span className="text-lg text-blueprint/40">{open ? "▾" : "▸"}</span>
          <div>
            <h3 className="font-semibold text-blueprint-dark">
              {room.name}
              {room.estimated && <span className="badge-amber ml-2">estimated dims</span>}
            </h3>
            <p className="text-xs text-blueprint/50">
              {room.type ?? "Room"} {room.floor != null && `· Floor ${room.floor}`}
              {room.width && room.depth && ` · ${room.width}ft × ${room.depth}ft`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm text-blueprint/60">
          <span>
            {tasksDone}/{room.tasks.length} tasks
          </span>
        </div>
      </button>

      {open && (
        <div className="space-y-6 border-t border-blueprint/10 p-5">
          <div className="flex items-end gap-3">
            <div>
              <label className="label">Width (ft)</label>
              <input className="input w-28" type="number" value={width} onChange={(e) => setWidth(e.target.value)} />
            </div>
            <div>
              <label className="label">Depth (ft)</label>
              <input className="input w-28" type="number" value={depth} onChange={(e) => setDepth(e.target.value)} />
            </div>
            <button className="btn-outline" onClick={saveDims} disabled={savingDims}>
              {savingDims ? "Saving…" : "Save dimensions"}
            </button>
            <button className="btn-ghost ml-auto text-red-600 hover:bg-red-50" onClick={onDeleteRequested}>
              Delete room
            </button>
          </div>

          <div>
            <h4 className="mb-2 text-sm font-semibold text-blueprint-dark">Tasks</h4>
            <div className="space-y-1">
              {room.tasks.map((t) => (
                <div key={t.id} className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-concrete">
                  <input
                    type="checkbox"
                    checked={t.done}
                    onChange={(e) => handleToggleTask(t.id, e.target.checked)}
                  />
                  <span className={`flex-1 text-sm ${t.done ? "text-blueprint/40 line-through" : ""}`}>
                    {t.title}
                  </span>
                  {t.due_date && <span className="text-xs text-blueprint/50">{t.due_date}</span>}
                  <button
                    className="text-xs text-red-500 opacity-0 hover:underline group-hover:opacity-100"
                    onClick={() => setDeletingTaskId(t.id)}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <input
                className="input flex-1"
                placeholder="New task"
                value={newTask}
                onChange={(e) => setNewTask(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddTask()}
              />
              <input
                className="input w-40"
                type="date"
                value={newTaskDue}
                onChange={(e) => setNewTaskDue(e.target.value)}
              />
              <button className="btn-outline" onClick={handleAddTask} disabled={addingTask || !newTask.trim()}>
                Add
              </button>
            </div>
          </div>

          <RenderingPanel projectId={projectId} room={room} onRoomUpdated={onRoomUpdated} />

          <FinishesPanel projectId={projectId} room={room} onRoomUpdated={onRoomUpdated} />
        </div>
      )}

      <ConfirmDialog
        open={!!deletingTaskId}
        title="Remove task?"
        message="This task will be permanently removed."
        confirmLabel="Remove"
        danger
        onCancel={() => setDeletingTaskId(null)}
        onConfirm={async () => {
          if (!deletingTaskId) return;
          const res = await deleteTask(projectId, deletingTaskId);
          if (!res.ok) {
            notify("error", res.error ?? "Could not remove task.");
          } else {
            onRoomUpdated({ ...room, tasks: room.tasks.filter((t) => t.id !== deletingTaskId) });
          }
          setDeletingTaskId(null);
        }}
      />
    </div>
  );
}
