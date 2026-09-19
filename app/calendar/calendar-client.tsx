"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatTimeWindow } from "@/lib/timeFormat";
import { Modal } from "@/components/Modal";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useToast } from "@/components/Toast";
import { addCalendarEvent, deleteCalendarEvent } from "@/app/calendar/actions";

export interface CalendarEntry {
  id: string;
  kind: "task" | "warranty_visit" | "event";
  // Only set for kind === "event" — the real calendar_events row id, used
  // to delete it (the `id` field above is prefixed for React-key uniqueness
  // across the three merged entry kinds).
  eventId?: string;
  title: string;
  dueDate: string;
  timeStart: string | null;
  timeEnd: string | null;
  subLabel: string;
  notes?: string | null;
  createdBy?: string;
  projectId: string;
  href: string | null;
}

interface ProjectOption {
  id: string;
  name: string;
}

const KIND_ICON: Record<CalendarEntry["kind"], string | null> = {
  task: null,
  warranty_visit: "🔧",
  event: "📅",
};

function formatDueDate(dueDate: string): string {
  // Parsed as a plain calendar date (no time/timezone component) rather
  // than handed straight to `new Date(dueDate)` — that treats a bare
  // "YYYY-MM-DD" as UTC midnight, which can display as the previous day
  // in a negative UTC offset.
  const [y, m, d] = dueDate.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function CalendarClient({
  entries: initialEntries,
  projects,
  currentUserId,
  canAddEvents,
  initialProjectId,
}: {
  entries: CalendarEntry[];
  projects: ProjectOption[];
  currentUserId: string | null;
  canAddEvents: boolean;
  // Set when arriving from a specific construction's own "Calendar" tab
  // (via /calendar?project=<id>) — pre-selects that construction's filter
  // instead of the usual defaulting logic below.
  initialProjectId?: string;
}) {
  const { notify } = useToast();
  const [entries, setEntries] = useState<CalendarEntry[]>(initialEntries);
  // Defaults to that one construction instead of "All constructions" when
  // there's only one to pick from anyway — the common case for a
  // 'warranty' account, which is usually assigned to just the one
  // construction it's tracking. Still just the initial value: the "All
  // constructions" option is right there if a second one is ever added.
  const [filterProjectId, setFilterProjectId] = useState<string>(
    () => initialProjectId ?? (projects.length === 1 ? projects[0].id : "")
  );
  const [addOpen, setAddOpen] = useState(false);
  const [deleting, setDeleting] = useState<CalendarEntry | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Compared as ISO date strings (which sort correctly lexicographically)
  // rather than Date objects, sidestepping the same UTC-midnight parsing
  // issue noted in formatDueDate above.
  const { todayStr, weekAheadStr } = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAhead = new Date(today);
    weekAhead.setDate(weekAhead.getDate() + 7);
    const toIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { todayStr: toIso(today), weekAheadStr: toIso(weekAhead) };
  }, []);

  const filtered = filterProjectId ? entries.filter((e) => e.projectId === filterProjectId) : entries;

  const overdue = filtered.filter((e) => e.dueDate < todayStr);
  const thisWeek = filtered.filter((e) => e.dueDate >= todayStr && e.dueDate < weekAheadStr);
  const later = filtered.filter((e) => e.dueDate >= weekAheadStr);

  const groups = (
    [
      { label: "Overdue", tone: "danger", items: overdue },
      { label: "Due this week", tone: "warn", items: thisWeek },
      { label: "Later", tone: "neutral", items: later },
    ] as { label: string; tone: "danger" | "warn" | "neutral"; items: CalendarEntry[] }[]
  ).filter((g) => g.items.length > 0);

  async function handleDelete() {
    if (!deleting?.eventId) return;
    setDeleteBusy(true);
    const res = await deleteCalendarEvent(deleting.eventId);
    setDeleteBusy(false);
    if (!res.ok) {
      notify("error", res.error ?? "Could not remove this item.");
      return;
    }
    setEntries((prev) => prev.filter((e) => e.id !== deleting.id));
    notify("success", "Removed.");
    setDeleting(null);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <select className="input w-auto" value={filterProjectId} onChange={(e) => setFilterProjectId(e.target.value)}>
          <option value="">All constructions</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {canAddEvents && (
          <button className="btn-amber" onClick={() => setAddOpen(true)} disabled={projects.length === 0}>
            + Add calendar item
          </button>
        )}
      </div>

      {groups.length === 0 ? (
        <div className="card p-10 text-center text-sm text-blueprint/60">
          Nothing due or scheduled{filterProjectId ? " for this construction" : ""}.
        </div>
      ) : (
        groups.map((group) => (
          <div key={group.label}>
            <p
              className={`mb-1.5 text-xs font-semibold uppercase tracking-wide ${
                group.tone === "danger" ? "text-red-600" : group.tone === "warn" ? "text-amber-dark" : "text-blueprint/50"
              }`}
            >
              {group.label} ({group.items.length})
            </p>
            <div className="card divide-y divide-blueprint/10">
              {group.items.map((entry) => {
                const timeWindow = formatTimeWindow(entry.timeStart, entry.timeEnd);
                const icon = KIND_ICON[entry.kind];
                const canRemove = entry.kind === "event" && entry.createdBy === currentUserId;
                const row = (
                  <>
                    <div className="min-w-0">
                      <p className="truncate text-sm text-blueprint-dark">
                        {icon && <span className="mr-1">{icon}</span>}
                        {entry.title}
                      </p>
                      <p className="truncate text-xs text-blueprint/50">
                        {entry.subLabel}
                        {entry.notes ? ` — ${entry.notes}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        className={`text-xs font-medium ${
                          group.tone === "danger" ? "text-red-600" : group.tone === "warn" ? "text-amber-dark" : "text-blueprint/50"
                        }`}
                      >
                        {formatDueDate(entry.dueDate)}
                        {timeWindow && `, ${timeWindow}`}
                      </span>
                      {canRemove && (
                        <button
                          className="text-xs text-red-500 hover:underline"
                          onClick={(e) => {
                            e.preventDefault();
                            setDeleting(entry);
                          }}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </>
                );
                const rowClass = "flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5 transition-colors hover:bg-concrete";
                return entry.href ? (
                  <Link key={entry.id} href={entry.href} className={rowClass}>
                    {row}
                  </Link>
                ) : (
                  <div key={entry.id} className={rowClass}>
                    {row}
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}

      <AddCalendarEventModal
        open={addOpen}
        projects={projects}
        onClose={() => setAddOpen(false)}
        onAdd={(entry) => {
          setEntries((prev) => [...prev, entry]);
          setAddOpen(false);
          notify("success", "Added to the calendar.");
        }}
      />

      <ConfirmDialog
        open={!!deleting}
        title="Remove this calendar item?"
        message={deleting ? `"${deleting.title}" will be permanently removed.` : ""}
        confirmLabel="Remove"
        danger
        busy={deleteBusy}
        onCancel={() => setDeleting(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}

function AddCalendarEventModal({
  open,
  projects,
  onClose,
  onAdd,
}: {
  open: boolean;
  projects: ProjectOption[];
  onClose: () => void;
  onAdd: (entry: CalendarEntry) => void;
}) {
  const { notify } = useToast();
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [timeStart, setTimeStart] = useState("");
  const [timeEnd, setTimeEnd] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setTitle("");
    setDate("");
    setTimeStart("");
    setTimeEnd("");
    setNotes("");
  }

  async function handleAdd() {
    if (!title.trim() || !date || !projectId) return;
    setSubmitting(true);
    const res = await addCalendarEvent(projectId, {
      title,
      notes: notes || null,
      eventDate: date,
      timeStart: timeStart || null,
      timeEnd: timeStart && timeEnd ? timeEnd : null,
    });
    setSubmitting(false);
    if (!res.ok || !res.id) {
      notify("error", res.error ?? "Could not add this item.");
      return;
    }
    const project = projects.find((p) => p.id === projectId);
    onAdd({
      id: `event-${res.id}`,
      kind: "event",
      eventId: res.id,
      title: title.trim(),
      dueDate: date,
      timeStart: timeStart || null,
      timeEnd: timeStart && timeEnd ? timeEnd : null,
      subLabel: project?.name ?? "Untitled construction",
      notes: notes.trim() || null,
      projectId,
      href: null,
    });
    reset();
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Add a calendar item"
      footer={
        <>
          <button className="btn-outline" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button className="btn-primary" disabled={submitting || !title.trim() || !date || !projectId} onClick={handleAdd}>
            {submitting ? "Adding…" : "Add"}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="label">Construction</label>
          <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">What is it?</label>
          <input
            className="input"
            placeholder="e.g. &quot;Site walkthrough with owner&quot;"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        </div>
        <div className="flex flex-wrap gap-3">
          <div>
            <label className="label">Date</label>
            <input className="input w-auto" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label className="label">Start time</label>
            <input className="input w-auto" type="time" value={timeStart} onChange={(e) => setTimeStart(e.target.value)} />
          </div>
          <div>
            <label className="label">End time</label>
            <input
              className="input w-auto"
              type="time"
              value={timeEnd}
              disabled={!timeStart}
              onChange={(e) => setTimeEnd(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="label">Notes (optional)</label>
          <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}
