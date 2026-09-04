"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Modal } from "@/components/Modal";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useToast } from "@/components/Toast";
import { createProject, deleteProject, renameProject } from "@/app/projects/actions";

export interface ProjectSummary {
  id: string;
  name: string;
  address: string | null;
  roomCount: number;
  tasksDone: number;
  tasksTotal: number;
  budgeted: number;
  actual: number;
}

function currency(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function ProjectsClient({ projects }: { projects: ProjectSummary[] }) {
  const { notify } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectSummary | null>(null);
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-blueprint-dark">Constructions</h2>
        <button className="btn-amber" onClick={() => setCreateOpen(true)}>
          + New construction
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="card p-10 text-center text-sm text-blueprint/60">
          No constructions yet. Create your first one to get started.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p, i) => {
            const taskPct = p.tasksTotal ? Math.round((p.tasksDone / p.tasksTotal) * 100) : 0;
            const budgetPct = p.budgeted ? Math.round((p.actual / p.budgeted) * 100) : 0;
            return (
              <div
                key={p.id}
                className="card card-hover flex animate-fade-in-up flex-col p-5"
                style={{ animationDelay: `${Math.min(i * 40, 400)}ms` }}
              >
                <Link href={`/projects/${p.id}`} className="flex-1">
                  <h3 className="font-semibold text-blueprint-dark transition-colors hover:text-amber">{p.name}</h3>
                  {p.address && <p className="mt-0.5 text-xs text-blueprint/50">{p.address}</p>}

                  <dl className="mt-4 space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <dt className="text-blueprint/60">Rooms</dt>
                      <dd className="font-medium">{p.roomCount}</dd>
                    </div>
                    <div className="flex items-center justify-between">
                      <dt className="text-blueprint/60">Tasks</dt>
                      <dd className="font-medium">
                        {p.tasksDone}/{p.tasksTotal}
                        {p.tasksTotal > 0 && <span className="ml-1 text-xs text-blueprint/40">({taskPct}%)</span>}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between">
                      <dt className="text-blueprint/60">Budget</dt>
                      <dd className="font-medium">
                        {currency(p.actual)} / {currency(p.budgeted)}
                        {p.budgeted > 0 && (
                          <span className={`ml-1 text-xs ${budgetPct > 100 ? "text-red-600" : "text-blueprint/40"}`}>
                            ({budgetPct}%)
                          </span>
                        )}
                      </dd>
                    </div>
                  </dl>
                </Link>

                <div className="mt-4 flex gap-2 border-t border-blueprint/10 pt-3">
                  <button className="btn-ghost flex-1 text-xs" onClick={() => setEditing(p)}>
                    Rename
                  </button>
                  <button
                    className="btn-ghost flex-1 text-xs text-red-600 hover:bg-red-50"
                    onClick={() => setDeleting(p)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <CreateProjectModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => notify("success", "Construction created.")}
      />

      {editing && (
        <EditProjectModal
          project={editing}
          onClose={() => setEditing(null)}
          onSaved={() => notify("success", "Construction updated.")}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Delete construction?"
        message={`This permanently deletes "${deleting?.name}" and everything in it: rooms, tasks, budget, checklist, and payments. This cannot be undone.`}
        confirmLabel="Delete"
        danger
        busy={pending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          startTransition(async () => {
            const res = await deleteProject(deleting.id);
            if (!res.ok) {
              notify("error", res.error ?? "Delete failed.");
            } else {
              notify("success", "Construction deleted.");
            }
            setDeleting(null);
          });
        }}
      />
    </div>
  );
}

function CreateProjectModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { notify } = useToast();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [pending, startTransition] = useTransition();

  function close() {
    setName("");
    setAddress("");
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="New construction"
      footer={
        <>
          <button className="btn-outline" onClick={close} disabled={pending}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={pending || !name.trim()}
            onClick={() =>
              startTransition(async () => {
                const res = await createProject(name, address);
                if (!res.ok) {
                  notify("error", res.error ?? "Could not create construction.");
                  return;
                }
                onCreated();
                close();
              })
            }
          >
            {pending ? "Creating…" : "Create"}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="label">Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Maple St. Residence" autoFocus />
        </div>
        <div>
          <label className="label">Address (optional)</label>
          <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="123 Maple St." />
        </div>
      </div>
    </Modal>
  );
}

function EditProjectModal({
  project,
  onClose,
  onSaved,
}: {
  project: ProjectSummary;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { notify } = useToast();
  const [name, setName] = useState(project.name);
  const [address, setAddress] = useState(project.address ?? "");
  const [pending, startTransition] = useTransition();

  return (
    <Modal
      open
      onClose={onClose}
      title="Rename construction"
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
                const res = await renameProject(project.id, name, address);
                if (!res.ok) {
                  notify("error", res.error ?? "Could not save changes.");
                  return;
                }
                onSaved();
                onClose();
              })
            }
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="label">Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div>
          <label className="label">Address</label>
          <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}
