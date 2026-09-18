"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

export interface CalendarTask {
  id: string;
  title: string;
  dueDate: string;
  roomName: string;
  projectId: string;
  projectName: string;
}

interface ProjectOption {
  id: string;
  name: string;
}

function formatDueDate(dueDate: string): string {
  // Parsed as a plain calendar date (no time/timezone component) rather
  // than handed straight to `new Date(dueDate)` — that treats a bare
  // "YYYY-MM-DD" as UTC midnight, which can display as the previous day
  // in a negative UTC offset.
  const [y, m, d] = dueDate.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function CalendarClient({ tasks, projects }: { tasks: CalendarTask[]; projects: ProjectOption[] }) {
  const [filterProjectId, setFilterProjectId] = useState<string>("");

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

  const filtered = filterProjectId ? tasks.filter((t) => t.projectId === filterProjectId) : tasks;

  const overdue = filtered.filter((t) => t.dueDate < todayStr);
  const thisWeek = filtered.filter((t) => t.dueDate >= todayStr && t.dueDate < weekAheadStr);
  const later = filtered.filter((t) => t.dueDate >= weekAheadStr);

  const groups = (
    [
      { label: "Overdue", tone: "danger", items: overdue },
      { label: "Due this week", tone: "warn", items: thisWeek },
      { label: "Later", tone: "neutral", items: later },
    ] as { label: string; tone: "danger" | "warn" | "neutral"; items: CalendarTask[] }[]
  ).filter((g) => g.items.length > 0);

  return (
    <div className="space-y-5">
      <select className="input w-auto" value={filterProjectId} onChange={(e) => setFilterProjectId(e.target.value)}>
        <option value="">All constructions</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>

      {groups.length === 0 ? (
        <div className="card p-10 text-center text-sm text-blueprint/60">
          No open tasks with a due date{filterProjectId ? " for this construction" : ""}.
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
              {group.items.map((task) => (
                <Link
                  key={task.id}
                  href={`/projects/${task.projectId}/rooms`}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-concrete"
                >
                  <div>
                    <p className="text-sm text-blueprint-dark">{task.title}</p>
                    <p className="text-xs text-blueprint/50">
                      {task.roomName} — {task.projectName}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 text-xs font-medium ${
                      group.tone === "danger" ? "text-red-600" : group.tone === "warn" ? "text-amber-dark" : "text-blueprint/50"
                    }`}
                  >
                    {formatDueDate(task.dueDate)}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
