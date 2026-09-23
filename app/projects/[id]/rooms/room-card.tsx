"use client";

import { useState, useTransition } from "react";
import { useToast } from "@/components/Toast";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FeetInchesInput } from "@/components/FeetInchesInput";
import { formatFeetInches } from "@/lib/feetInches";
import {
  addTask,
  deleteTask,
  deleteTasks,
  toggleTask,
  toggleTasks,
  updateRoomDimensions,
} from "@/app/projects/[id]/rooms/actions";
import { usePersistedSelection } from "@/lib/usePersistedSelection";
import { RenderingPanel } from "@/app/projects/[id]/rooms/rendering-panel";
import { FinishesPanel } from "@/app/projects/[id]/rooms/finishes-panel";
import { RoughInPanel } from "@/app/projects/[id]/rooms/rough-in-panel";
import type { RoomWithRelations } from "@/app/projects/[id]/rooms/room-types";

export function RoomCard({
  projectId,
  room,
  hasPlanPages,
  onViewPlans,
  onDeleteRequested,
  onRoomUpdated,
}: {
  projectId: string;
  room: RoomWithRelations;
  hasPlanPages: boolean;
  onViewPlans: () => void;
  onDeleteRequested: () => void;
  onRoomUpdated: (room: RoomWithRelations) => void;
}) {
  const { notify } = useToast();
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState<number | null>(room.width);
  const [depth, setDepth] = useState<number | null>(room.depth);
  const [savingDims, startSavingDims] = useTransition();
  const [newTask, setNewTask] = useState("");
  const [newTaskDue, setNewTaskDue] = useState("");
  const [addingTask, startAddingTask] = useTransition();
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [selectedTasks, setSelectedTasks] = usePersistedSelection(`room-tasks-selected:${projectId}:${room.id}`, () => new Set());
  const [selectModeTasks, setSelectModeTasks] = useState(false);
  const [confirmBulkDeleteTasks, setConfirmBulkDeleteTasks] = useState(false);
  const [bulkTasksBusy, setBulkTasksBusy] = useState(false);
  const allTasksSelected = room.tasks.length > 0 && room.tasks.every((t) => selectedTasks.has(t.id));

  const tasksDone = room.tasks.filter((t) => t.done).length;

  function saveDims() {
    startSavingDims(async () => {
      const res = await updateRoomDimensions(projectId, room.id, width, depth);
      if (!res.ok) {
        notify("error", res.error ?? "Could not save dimensions.");
        return;
      }
      onRoomUpdated({ ...room, width, depth });
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

  function toggleSelectTask(taskId: string) {
    setSelectedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }

  function selectAllTasks(check: boolean) {
    setSelectedTasks((prev) => {
      const next = new Set(prev);
      room.tasks.forEach((t) => (check ? next.add(t.id) : next.delete(t.id)));
      return next;
    });
  }

  async function handleBulkToggleTasks(markDone: boolean) {
    const ids = room.tasks.filter((t) => selectedTasks.has(t.id)).map((t) => t.id);
    if (ids.length === 0) return;
    setBulkTasksBusy(true);
    const idSet = new Set(ids);
    onRoomUpdated({ ...room, tasks: room.tasks.map((t) => (idSet.has(t.id) ? { ...t, done: markDone } : t)) });
    const res = await toggleTasks(projectId, ids, markDone);
    setBulkTasksBusy(false);
    if (!res.ok) {
      notify("error", res.error ?? "Could not update tasks.");
      onRoomUpdated({ ...room, tasks: room.tasks.map((t) => (idSet.has(t.id) ? { ...t, done: !markDone } : t)) });
      return;
    }
    notify("success", `${ids.length} task${ids.length === 1 ? "" : "s"} marked ${markDone ? "done" : "not done"}.`);
  }

  async function handleBulkDeleteTasks() {
    const ids = room.tasks.filter((t) => selectedTasks.has(t.id)).map((t) => t.id);
    if (ids.length === 0) return;
    setBulkTasksBusy(true);
    const res = await deleteTasks(projectId, ids);
    setBulkTasksBusy(false);
    setConfirmBulkDeleteTasks(false);
    if (!res.ok) {
      notify("error", res.error ?? "Could not delete tasks.");
      return;
    }
    const deletedIds = new Set(res.deletedIds ?? ids);
    onRoomUpdated({ ...room, tasks: room.tasks.filter((t) => !deletedIds.has(t.id)) });
    setSelectedTasks((prev) => {
      const next = new Set(prev);
      deletedIds.forEach((id) => next.delete(id));
      return next;
    });
    notify("success", `${deletedIds.size} task${deletedIds.size === 1 ? "" : "s"} deleted.`);
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
              {room.width && room.depth && ` · ${formatFeetInches(room.width)} × ${formatFeetInches(room.depth)}`}
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
              <label className="label">Width</label>
              <FeetInchesInput value={width} onChange={setWidth} className="w-36" />
            </div>
            <div>
              <label className="label">Depth</label>
              <FeetInchesInput value={depth} onChange={setDepth} className="w-36" />
            </div>
            <button className="btn-outline" onClick={saveDims} disabled={savingDims}>
              {savingDims ? "Saving…" : "Save dimensions"}
            </button>
            <button
              className="btn-ghost text-sm"
              onClick={onViewPlans}
              disabled={!hasPlanPages}
              title={hasPlanPages ? "Check this against the plan" : "Upload plan pages on the Plan tab first"}
            >
              View plans
            </button>
            <button className="btn-ghost ml-auto text-red-600 hover:bg-red-50" onClick={onDeleteRequested}>
              Delete room
            </button>
          </div>
          {room.estimated && (
            <p className="-mt-4 text-xs text-blueprint/50">
              These dimensions were AI-estimated from the plan — worth double-checking against it above if
              anything looks off.
            </p>
          )}

          <div>
            <h4 className="mb-2 text-sm font-semibold text-blueprint-dark">Tasks</h4>
            {room.tasks.length > 0 && (
              <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs">
                {!selectModeTasks ? (
                  <button className="text-blueprint/60 hover:underline" onClick={() => setSelectModeTasks(true)}>
                    Select
                  </button>
                ) : (
                  <>
                    <label className="flex items-center gap-1.5 text-blueprint/60">
                      <input type="checkbox" checked={allTasksSelected} onChange={(e) => selectAllTasks(e.target.checked)} />
                      {selectedTasks.size > 0 ? `${selectedTasks.size} selected` : "Select all"}
                    </label>
                    {selectedTasks.size > 0 && (
                      <>
                        <button className="text-blueprint/60 hover:underline" onClick={() => handleBulkToggleTasks(true)} disabled={bulkTasksBusy}>
                          Mark done
                        </button>
                        <button className="text-blueprint/60 hover:underline" onClick={() => handleBulkToggleTasks(false)} disabled={bulkTasksBusy}>
                          Mark not done
                        </button>
                        <button
                          className="text-red-500 hover:underline"
                          onClick={() => setConfirmBulkDeleteTasks(true)}
                          disabled={bulkTasksBusy}
                        >
                          Delete selected
                        </button>
                      </>
                    )}
                    <button
                      className="text-blueprint/40 hover:underline"
                      onClick={() => {
                        selectAllTasks(false);
                        setSelectModeTasks(false);
                      }}
                      disabled={bulkTasksBusy}
                    >
                      Done
                    </button>
                  </>
                )}
              </div>
            )}
            <div className="space-y-1">
              {room.tasks.map((t) => (
                <div key={t.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-2 py-1.5 hover:bg-concrete">
                  <input
                    type="checkbox"
                    checked={selectModeTasks ? selectedTasks.has(t.id) : t.done}
                    onChange={(e) => (selectModeTasks ? toggleSelectTask(t.id) : handleToggleTask(t.id, e.target.checked))}
                    title={selectModeTasks ? "Select for bulk actions" : undefined}
                  />
                  <span className={`min-w-0 flex-1 basis-32 text-sm ${t.done ? "text-blueprint/40 line-through" : ""}`}>
                    {t.title}
                  </span>
                  {t.due_date && <span className="shrink-0 text-xs text-blueprint/50">{t.due_date}</span>}
                  {/* Always visible — opacity-0 until :hover left this
                      unreachable on touch devices, which have no hover state. */}
                  <button
                    className="ml-auto shrink-0 text-xs text-red-500 hover:underline"
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

          <RoughInPanel projectId={projectId} room={room} onRoomUpdated={onRoomUpdated} />

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

      <ConfirmDialog
        open={confirmBulkDeleteTasks}
        title="Delete selected tasks?"
        message={`${selectedTasks.size} task${selectedTasks.size === 1 ? "" : "s"} will be permanently removed.`}
        confirmLabel="Delete"
        danger
        busy={bulkTasksBusy}
        onCancel={() => setConfirmBulkDeleteTasks(false)}
        onConfirm={handleBulkDeleteTasks}
      />
    </div>
  );
}
